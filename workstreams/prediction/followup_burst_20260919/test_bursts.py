"""Arithmetic, causality, reference exclusion and adversarial characterization."""
import math
import unittest
import warnings
import numpy as np
from workstreams.prediction.followup_burst_20260919 import audit_bursts as b

class BurstAuditTests(unittest.TestCase):
    def setUp(self):
        self.sites=np.array([b.SITES[i%4] for i in range(80)])
        self.x=np.tile(np.array([1. if (i//4)%2 else -1. for i in range(80)])[:,None],(1,24))
        self.families={'same':list(range(24))}
        self.ref=b.fit_reference({1:(self.x,self.sites)},[1])

    def rows(self,x,sites=None):
        sites=self.sites if sites is None else sites
        return b.scans_for(b.burst_flags(b.standardize(x,sites,self.ref),self.families)[0],sites)

    def test_exact_fisher_extreme_table(self):
        self.assertAlmostEqual(b.fisher_greater(4,4,0,4),1/70)

    def test_fisher_all_or_no_events(self):
        self.assertEqual(b.fisher_greater(0,40,0,40),1)
        self.assertEqual(b.fisher_greater(40,40,40,40),1)

    def test_invalid_table_rejected(self):
        with self.assertRaises(ValueError): b.fisher_greater(41,40,0,40)

    def test_scale_convention(self):
        np.testing.assert_allclose(self.ref['1']['scale'],1.4826)

    def test_excluded_wafer_cannot_change_fit(self):
        d={1:(self.x,self.sites),2:(self.x*1e6,self.sites)}
        ref=b.fit_reference(d,[1])
        for s in b.SITES: np.testing.assert_array_equal(ref[s]['median'],self.ref[s]['median'])

    def test_zero_mad_constant_abstains(self):
        ref=b.fit_reference({1:(np.ones_like(self.x),self.sites)},[1])
        self.assertTrue(all(np.all(v['method']=='abstain') for v in ref.values()))
        self.assertTrue(np.isnan(b.standardize(self.x,self.sites,ref)).all())

    def test_zero_mad_positive_sd_fallback(self):
        x=np.zeros_like(self.x); x[:4]=5
        ref=b.fit_reference({1:(x,self.sites)},[1])
        self.assertTrue(all(np.all(v['method']=='SD') for v in ref.values()))
        self.assertTrue(np.isfinite(b.standardize(x,self.sites,ref)).all())

    def test_missing_site_abstains(self):
        x=self.x.copy(); x[self.sites=='4']=np.nan
        self.assertFalse(any(r['eligible'] for r in self.rows(x)))

    def test_unknown_site_abstains(self):
        sites=self.sites.copy(); sites[0]='9'
        self.assertFalse(any(r['eligible'] for r in self.rows(self.x,sites)))

    def test_fixed_site_offsets_are_removed(self):
        x=self.x.copy()
        for i,s in enumerate(b.SITES): x[self.sites==s]+=100*i
        ref=b.fit_reference({1:(x,self.sites)},[1])
        np.testing.assert_allclose(b.standardize(x,self.sites,ref),1/1.4826)

    def test_single_extreme_test_not_burst(self):
        x=self.x.copy(); x[:,0]+=100
        flags,_=b.burst_flags(b.standardize(x,self.sites,self.ref),self.families)
        self.assertEqual(flags['same'].sum(),0)

    def test_four_correlated_tests_count_one_event(self):
        x=self.x.copy(); x[0,:4]+=100
        flags,counts=b.burst_flags(b.standardize(x,self.sites,self.ref),self.families)
        self.assertEqual(counts['same'][0],4); self.assertEqual(flags['same'].sum(),1)

    def test_isolated_impulse_cannot_pass_early_minimum(self):
        x=self.x.copy(); x[0]+=100
        self.assertFalse(any(r['eligible'] for r in self.rows(x)))

    def test_unchanged_noise_returning_mean_false_alert_characterized(self):
        x=self.x.copy(); x[:40]+=100
        self.assertTrue(b.alerts(self.rows(x),-math.log10(.05/42)))

    def test_away_mean_step_has_no_decline(self):
        x=self.x.copy(); x[40:]+=100
        self.assertFalse(b.alerts(self.rows(x),-math.log10(.05)))

    def test_stable_and_increasing_bursts_no_alert(self):
        for mask in (np.arange(80)%4==0,(np.arange(80)>=40)&(np.arange(80)%4==0)):
            x=self.x.copy(); x[mask,:4]+=100
            self.assertFalse(b.alerts(self.rows(x),-math.log10(.05)))

    def test_decreasing_bursts_detected_nominally(self):
        x=self.x.copy(); x[(np.arange(80)<40)&(np.arange(80)%4==0),:4]+=100
        self.assertTrue(b.alerts(self.rows(x),-math.log10(.05)))

    def test_future_suffix_cannot_change_prior_scans(self):
        x=self.x.copy(); x[48:]+=1e6
        self.assertEqual([r for r in self.rows(x) if r['n']<=48],
                         [r for r in self.rows(self.x) if r['n']<=48])

    def test_short_prefix_has_no_scan(self):
        self.assertEqual(b.scans_for({'same':np.zeros(31)},self.sites[:31]),[])

    def test_reset_has_no_previous_wafer_state(self):
        x=self.x.copy(); x[:40]+=100
        b.alerts(self.rows(x),1.3)
        self.assertEqual(b.alerts(self.rows(self.x),1.3),[])

    def test_site_mix_guard_blocks_confound(self):
        sites=np.array(['1']*32+['2']*16+['3']*16+['4']*16)
        x=self.x.copy(); x[sites=='1',:4]+=100; rows=self.rows(x,sites)
        self.assertTrue(b.alerts(rows,1.3))
        self.assertFalse(b.alerts(rows,1.3,require_balance=True))

    def test_normal_envelope_covers_all_supplied_scan_scores(self):
        gate,maximum=b.calibration_gate([[{'score':2.}],[{'score':5.}]])
        self.assertEqual(maximum,5.); self.assertGreater(gate,5.)

    def test_families_are_symmetric(self):
        z=np.ones((80,48)); z[:40,:4]=100; z[:40,24:28]=100
        flags,_=b.burst_flags(z,{'a':list(range(24)),'b':list(range(24,48))})
        np.testing.assert_array_equal(flags['a'],flags['b'])

    def test_out_of_scope_output_rejected(self):
        with self.assertRaises(ValueError): b.output_path(b.HERE.parent/'round3')

if __name__=='__main__': unittest.main()
