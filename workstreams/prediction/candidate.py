"""Offline proposal: use a small causal model only when the primary abstains.

No cache, lifecycle handling, native SDK calls or runtime integration lives here.
The caller must supply one already-isolated device/site snapshot per call.
"""
import math


def strict_predict(model, values):
    """Return (value or None, selected-input coverage); never impute at inference."""
    if not model or not model.get('features'):
        return None, 0.0
    features = model['features']
    present = sum(name in values and isinstance(values[name], (int, float))
                  and math.isfinite(values[name]) for name in features)
    coverage = present / len(features)
    if present != len(features):
        return None, coverage
    result = model['intercept']
    for i, name in enumerate(features):
        result += ((values[name] - model['mean'][i]) / model['scale'][i]) * model['coef'][i]
    return (result if math.isfinite(result) else None), coverage


class SparseFallback:
    def __init__(self, primary, models):
        self.primary = primary
        self.models = models

    def predict(self, stage, values):
        value, primary_coverage = self.primary.predict(stage, values)
        if value is not None:
            return {'value': value, 'source': 'primary',
                    'primary_coverage': primary_coverage, 'used_model_coverage': primary_coverage}
        value, coverage = strict_predict(self.models.get(str(stage)), values)
        return {'value': value, 'source': 'sparse8' if value is not None else 'unavailable',
                'primary_coverage': primary_coverage, 'used_model_coverage': coverage}

    def predict_scoped(self, stage, snapshots):
        """Keep caller-supplied scope keys; never merge values between snapshots."""
        return {scope: self.predict(stage, values) for scope, values in snapshots.items()}
