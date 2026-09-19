import copy
import itertools
import math
import unittest
import numpy as np
from .candidate import CONFIG, SparseBurstDetector, fisher_decrease
from .controls import calibration, stream, run_case
from .diagnose import fit
from .evaluate import calibrate, retained


class SparseBurstTests(unittest.TestCase):
    def test_fisher_matches_exhaustive_assignments(self):
        for n in range(1,5):
            for a in range(n+1):
                for b in range(n+1):
                    choices=list(itertools.combinations(range(2*n),a+b))
                    exact=sum(sum(i<n for i in xs)>=a for xs in choices)/len(choices)
                    self.assertEqual(fisher_decrease(a,b,n,n),exact)
        self.assertAlmostEqual(fisher_decrease(7,1,40,40),.028379336979995902)

    def test_strong_decline_and_mean_step_nonidentifiability(self):
        a=run_case('strong_sparse_decline',0); b=run_case('constant_noise_mean_step_down',0)
        self.assertTrue(a['alerts']); self.assertEqual(a['alerts'],b['alerts'])

    def test_stationary_increase_single_test_impulse_and_step_up(self):
        for case in ('stationary_regular_bursts','burst_rate_increase','one_extreme_test','one_impulse','permanent_mean_step_up','site_specific_constant_offset'):
            self.assertEqual(run_case(case,0)['alerts'],[],case)

    def test_transient_mean_excursion_is_known_specificity_failure(self):
        self.assertTrue(run_case('transient_mean_excursion',0)['alerts'])

    def test_prefix_and_reset(self):
        c=calibration(); a=SparseBurstDetector(c); b=SparseBurstDetector(c)
        for site,values in stream('strong_sparse_decline',1,n=48,c=c):
            a.add(site,values); b.add(site,dict(values))
            self.assertEqual(a.analyze(),b.analyze()); self.assertEqual(a.latest_scans,b.latest_scans)
        fresh=SparseBurstDetector(c)
        self.assertEqual(fresh.completed,0); self.assertEqual(fresh.emitted,set())

    def test_invalid_family_preserves_position_and_abstains(self):
        for bad in (None,True,float('nan'),float('inf'),'bad'):
            c=calibration(); d=SparseBurstDetector(c)
            for i,(s,v) in enumerate(stream('strong_sparse_decline',0,c=c),1):
                if i==3: v['f0_test0']=bad
                d.add(s,v); self.assertEqual(d.analyze(),[])
            self.assertFalse(d.latest_scans[0]['ready']); self.assertEqual(len(d.windows['family0']),80)

    def test_unknown_site_invalidates_scope(self):
        d=SparseBurstDetector(calibration())
        for i,(s,v) in enumerate(stream('strong_sparse_decline',0),1):
            d.add('9' if i==2 else s,v); self.assertEqual(d.analyze(),[])
        self.assertTrue(d.invalid_scope)

    def test_incomplete_site_layout_abstains(self):
        d=SparseBurstDetector(calibration())
        for s,v in stream('strong_sparse_decline',0):
            d.add('1',v); self.assertEqual(d.analyze(),[])
        self.assertFalse(d.latest_scans[0]['ready'])

    def test_duplicate_and_off_cadence_final_abstain(self):
        d=SparseBurstDetector(calibration())
        for s,v in stream('strong_sparse_decline',0,n=39): d.add(s,v); d.analyze()
        k=d.scan_index
        self.assertEqual(d.analyze(final=True),[]); self.assertEqual(d.scan_index,k)
        s,v=next(stream('strong_sparse_decline',0)); d.add('4',v); d.analyze()
        k=d.scan_index
        self.assertEqual(d.analyze(final=True),[]); self.assertEqual(d.scan_index,k)

    def test_bounded_long_stream(self):
        c=calibration(); d=SparseBurstDetector(c)
        for s,v in stream('stationary_regular_bursts',0,n=800,c=c): d.add(s,v); d.analyze()
        self.assertEqual(retained(d)['window_records'],480)
        self.assertTrue(all(len(r['evidence'])<=8 for w in d.windows.values() for r in w))

    def test_spending_budget(self):
        total=sum(CONFIG['familywise_alpha']/(k*(k+1)) for k in range(1,10001))
        self.assertLess(total,.05); self.assertGreater(total,.04999)

    def test_mad_zero_fallback_finite_positive(self):
        names=['a','b','c','d']; rows=[{'Wafer':'2','Site':'1'} for _ in range(8)]
        c=fit({'detector_calibration':{'normal_fit_wafers':[2]}},names,rows,np.zeros((8,4)),{'f':list(range(4))})
        for b in c['by_site']['1'].values():
            self.assertTrue(b['fallback_used']); self.assertTrue(math.isfinite(b['scale'])); self.assertGreater(b['scale'],0)

    def test_calibration_excludes_other_wafers(self):
        seed=calibration(); seed['normal_fit_wafers']=[2]
        normal={'wafer':2,'devices':80,'conventions':{'scale':{'events':[]}}}
        other={'wafer':25,'devices':80,'conventions':{'scale':{'events':[{'completed_devices':i,'family':'family0'} for i in range(1,25)]}}}
        a=calibrate(seed,{'wafers':[normal,other]})
        other['conventions']['scale']['events']=[]
        self.assertEqual(a,calibrate(seed,{'wafers':[normal,other]}))

    def test_four_tests_and_strict_threshold(self):
        c=calibration(); d=SparseBurstDetector(c); values={t:0 for ts in c['families'].values() for t in ts}
        for t in c['families']['family0'][:4]: values[t]=20
        d.add('1',values); self.assertFalse(d.latest_device[0]['burst'])
        for t in c['families']['family0'][:4]: values[t]=20.01
        d.add('2',values); self.assertTrue(d.latest_device[0]['burst'])

    def test_invalid_configuration(self):
        c=calibration(); c['by_site']['1']['f0_test0']['scale']=0
        with self.assertRaises(ValueError): SparseBurstDetector(c)
        c=calibration(); c['config']['z_threshold']=19
        with self.assertRaises(ValueError): SparseBurstDetector(c)


if __name__=='__main__': unittest.main()
