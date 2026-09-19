"""Behavior checks for the offline proposal; no SDK or machine acceptance."""
import copy
import json
import math
import unittest
from pathlib import Path

import numpy as np

from grp6_app.runtime import RuntimeModels
from workstreams.prediction.candidate import SparseFallback, strict_predict
from workstreams.prediction.evaluate import comparison, fit_pair, output_directory, score, strict_matrix


def model(features, coefficients):
    return {'features': features, 'median': [0.0] * len(features),
            'mean': [0.0] * len(features), 'scale': [1.0] * len(features),
            'coef': coefficients, 'intercept': 10.0}


class PredictionChecks(unittest.TestCase):
    def setUp(self):
        # Call the actual baseline runtime method with a minimal valid artifact in memory.
        self.primary = RuntimeModels.__new__(RuntimeModels)
        self.primary.models = {'1': model(['a', 'b'], [1.0, 2.0])}
        self.sparse = model(['a'], [3.0])
        self.candidate = SparseFallback(self.primary, {'1': self.sparse})

    def test_primary_is_preserved_even_when_sparse_disagrees(self):
        result = self.candidate.predict(1, {'a': 2.0, 'b': 4.0})
        self.assertEqual(result['value'], 20.0)
        self.assertEqual(result['source'], 'primary')
        self.assertNotEqual(result['value'], strict_predict(self.sparse, {'a': 2.0})[0])

    def test_missing_primary_input_uses_complete_sparse_model(self):
        result = self.candidate.predict(1, {'a': 2.0})
        self.assertEqual(result, {'value': 16.0, 'source': 'sparse8',
                                 'primary_coverage': 0.5, 'used_model_coverage': 1.0})

    def test_missing_sparse_input_never_imputes_or_reuses_previous_device(self):
        self.candidate.predict(1, {'a': 9.0})
        for values in ({}, {'b': 4.0}, {'a': float('nan')}, {'a': float('inf')}, {'a': -float('inf')}):
            with self.subTest(values=values):
                result = self.candidate.predict(1, values)
                self.assertIsNone(result['value'])
                self.assertEqual(result['source'], 'unavailable')
        self.assertEqual(strict_predict(self.sparse, {'a': None}), (None, 0.0))
        self.assertEqual(strict_predict(self.sparse, {'a': 'bad'}), (None, 0.0))

    def test_unknown_stage_abstains(self):
        result = self.candidate.predict(7, {'a': 1.0, 'b': 2.0})
        self.assertIsNone(result['value'])
        self.assertEqual(result['source'], 'unavailable')

    def test_overflow_does_not_escape_as_infinity(self):
        result = self.candidate.predict(1, {'a': 1e308, 'b': 1e308})
        self.assertIsNone(result['value'])
        self.assertEqual(result['source'], 'unavailable')

    def test_all_scope_dimensions_remain_separate_and_order_independent(self):
        base = ('run', 'tester', 'lot', 'wafer', 'device', 'site', 'head', 'attempt')
        snapshots = {base: {'a': 1.0}}
        for index in range(len(base)):
            changed = list(base)
            changed[index] += '-other'
            snapshots[tuple(changed)] = {'a': float(index + 2)}
        empty_scope = ('empty',) * 8
        snapshots[empty_scope] = {}
        saved = copy.deepcopy(snapshots)
        original = self.candidate.predict_scoped(1, snapshots)
        reverse = self.candidate.predict_scoped(1, dict(reversed(list(snapshots.items()))))
        self.assertEqual(original, reverse)
        for scope, values in snapshots.items():
            self.assertEqual(original[scope], self.candidate.predict(1, values))
        self.assertIsNone(original[empty_scope]['value'])
        self.assertEqual(snapshots, saved)

    def test_irrelevant_future_targets_bins_and_labels_cannot_change_prediction(self):
        values = {'a': 2.0, 'b': 4.0}
        expected = self.candidate.predict(1, values)
        values.update({'200_Main.sensor6#IO3': -1e100, 'future': 1e100,
                       'SBin': 30, 'PF': 0, 'wafer_label': 'abnormal'})
        self.assertEqual(self.candidate.predict(1, values), expected)

    def test_runtime_and_matrix_agree_with_missing_inputs(self):
        values = np.array([[1.0, 2.0], [3.0, np.nan], [np.inf, 1.0]])
        predicted, coverage = strict_matrix(self.primary.models['1'], values, ['a', 'b'])
        for i, row in enumerate(values):
            actual, cov = self.primary.predict(1, dict(zip(['a', 'b'], row)))
            self.assertEqual(cov, coverage[i])
            if actual is None:
                self.assertTrue(np.isnan(predicted[i]))
            else:
                self.assertAlmostEqual(actual, predicted[i])

    def test_training_statistics_use_only_given_training_rows(self):
        train = np.array([[1.0, 7.0], [3.0, np.nan], [5.0, 9.0], [7.0, 11.0]])
        y = np.array([1.0, 2.0, 3.0, 4.0])
        primary, sparse = fit_pair(train, y, ['a', 'b'])
        for fitted in (primary, sparse):
            a, b = fitted['features'].index('a'), fitted['features'].index('b')
            self.assertEqual(fitted['median'][a], 4.0)
            self.assertEqual(fitted['median'][b], 9.0)
            self.assertEqual(fitted['mean'][b], 9.0)
        # Inference with held-out extremes must not update training parameters.
        saved = copy.deepcopy(sparse)
        strict_matrix(sparse, np.array([[1e90, -1e90]]), ['a', 'b'])
        self.assertEqual(sparse, saved)

    def test_insufficient_training_data_fails_explicitly(self):
        for x, y, names in [(np.empty((0, 1)), np.array([]), ['a']),
                            (np.ones((1, 1)), np.array([2.0]), ['a']),
                            (np.full((2, 1), np.nan), np.array([1.0, 2.0]), ['a']),
                            (np.ones((2, 1)), np.array([1.0, np.nan]), ['a'])]:
            with self.subTest(shape=x.shape), self.assertRaises(ValueError):
                fit_pair(x, y, names)

    def test_empty_predictions_have_null_errors_and_zero_coverage(self):
        result = score(np.array([1.0, 2.0]), np.array([np.nan, np.nan]),
                       np.zeros(2), np.zeros(2))
        self.assertEqual(result['predicted_count'], 0)
        self.assertEqual(result['prediction_coverage'], 0.0)
        self.assertIsNone(result['mae'])
        self.assertIsNone(result['worst_error'])
        json.dumps(result, allow_nan=False)

    def test_comparisons_do_not_confuse_added_rows_with_paired_accuracy(self):
        result = comparison(np.array([1.0, 2.0]), np.array([1.1, np.nan]), np.array([1.2, 5.0]))
        self.assertEqual(result['common_count'], 1)
        self.assertEqual(result['added_count'], 1)
        self.assertAlmostEqual(result['mae_delta_common_rows'], 0.1)
        self.assertEqual(result['added_rows_mae'], 3.0)

    def test_outputs_cannot_escape_workstream(self):
        for path in ('grp6_app/artifacts', 'results', 'workstreams/prediction',
                     'workstreams/prediction/../detection/results'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                output_directory(path)
        self.assertEqual(output_directory('workstreams/prediction/results'),
                         Path('workstreams/prediction/results').resolve())


if __name__ == '__main__':
    unittest.main()
