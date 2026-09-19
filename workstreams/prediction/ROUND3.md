# B independent W25 audit — R3-20260919

**READY_FOR_A — negative research delivered. A rejected the candidate after the mean-step and isolated-impulse controls failed. No runtime or replay promotion: the accepted baseline remains 6/7, W25 missed.** Independent arithmetic reproduced a proposed W25 alert, but that does not supersede the rejection.

Published base: 810b4ac9549a619ab09e9145f656c363c6d75035. Shared checkout C:/Users/USER/Documents/hackathon2026, main. B authored only workstreams/prediction/**, performed no Git mutation or machine access, and preserved prior evidence. A owns commits/publication. All wafers are reused development data; independent implementation is not independent validation.

## Reproduce

Run from repository root with the existing Python/NumPy environment:

    python -B -m workstreams.prediction.spread_audit --output workstreams/prediction/round3
    python -B -m workstreams.prediction.challenge_pooled --output workstreams/prediction/round3
    python -B -m workstreams.prediction.review_pooled_snapshot --source workstreams/prediction/round3/c-source-9b5f530d47cf11ae6ee0009cb348b5101bae40a8332ebd32bdea3c347560aba8.txt --output workstreams/prediction/recheck-r3
    python -B -m unittest discover -s workstreams/prediction -p 'test_*.py' -v
    git diff --check

spread_audit defaults to round3 and reads exact base Git blobs for 25 source_review/training/Data CSVs, grp6_app/artifacts/runtime.json, grp6_app/runtime.py and results/replay/summary.json. It requires that commit locally; it never fetches. challenge_pooled defaults to the same output, reads its baseline.json and independently recomputes the proposed statistic from immutable inputs without importing C. review_pooled_snapshot defaults to the current read-only C pooled_candidate.py; the explicit preserved-source command above reproduces the rejected version. All output paths resolve inside B's workstream; outside paths and symlink escapes are rejected. Use a fresh B subdirectory to preserve subsequent runs.

Reusable comparison command:

    python -B -m workstreams.prediction.spread_audit --candidate-summary <summary.json> --baseline-summary workstreams/prediction/round3/baseline.json --output workstreams/prediction/comparison-r3

Input is a normalized object with wafers records containing wafer, devices and alerts. It requires exactly one record for all 25 wafers and 80 devices each. It checks baseline alert signatures/timing, all expected categories, W2 and every normal-label wafer. It explicitly leaves candidate synthetic/causality gates unevaluated. Negative research findings are recorded without misrepresenting successful auditor execution as a command failure.

## Frozen acceptance and data

round3/acceptance-matrix.json was frozen before C comparison: W25 spread-down by device 80; all six other expected categories no later than baseline; W2 legitimate low yield retained; every baseline kind/site/test/device signature occurrence retained; no extra alerts on all 18 normal-labeled wafers including W2; no-change, reduction, mean/site shift, missing/nonfinite and causal-prefix controls. Extra categories on abnormal wafers are visible. The impulse case was added later as a robustness challenge.

The baseline audit executes published runtime bytes in memory using Python float values, reproducing **every saved baseline alert payload exactly**. The exports contain 25 × 80 devices, four sites with 20 devices each, 3,036 measurement columns and **6,072,000 finite cells; zero blank, nonfinite or malformed cells**. Identity/bin metadata is separate. Only the unchanged low-yield baseline receives bins. No retraining, model change, ID/label feature or future-observation input was introduced.

Normal-reference wafers are the inherited fit partition: **2,4,5,7,8,10,11,13,16,17,19,20,22**. Comparisons use the same completed-device prefix, excluding the subject itself: 12 references for fit wafers, 13 otherwise. Reference dispersion must be finite and positive for every contributing reference. W6/12/15/21/24 were already inspected; none are independent holdouts.

round3/provenance.json records exact blob/checkout SHA256 values, environment, source revision and output hashes. CRLF can explain different checkout hashes; immutable inputs are not rewritten. round3/validation.json records final checks, hashes and prior-file preservation; round3/inventory.json inventories every retained file and its references.

## Absolute and temporal spread signals

Population SD is reported per test/site, across pooled devices and as equal-site within SD: sqrt(mean(site variance)). Prefixes are 32,40,48,56,64,72,80. Temporal diagnostics compare early/late halves only inside that prefix, omit the odd center sample, and use the frozen 0.1 × baseline-SD floor. Full-wafer descriptions never feed earlier decisions.

The compressed test-site-dispersion table contains **455,400** records: 25 wafers × 3,036 tests × six groups. It includes counts, missingness, means/SDs, baseline eligibility, reference median/minimum ratios and temporal effects. For within, n is minimum finite site count; mean is equal-site mean; missingness counts cover all rows. family-prefix and temporal-prefix each contain **7,350** records. Their seven families use 3,024 existing baseline tests: Main has 24 and subflows 1–6 have 500 each. All 12 excluded columns remain in the descriptive table.

W25 full-wafer family median SD/reference ratios are **1.0833–1.0997 within sites**, **1.0860–1.1127 pooled**: not a broadly low-spread wafer. Only three subflow-1 tests fall below 0.7 of the normal median: 4440 (0.2396), 4420 (0.3310), 4280 (0.3616). They remain 1.1241, 1.2601, 1.2758 times the normal minimum. Absolute SD alone does not justify a W25-specific rule.

The proposed signal is instead sparse and temporal. Pool early within-site variances and late within-site variances separately, take their SD log ratio, then family q95. Fixed site mean offsets cancel, while a site's unusually large early variance can dominate. At W25@80, 32/500 subflow-1 tests exceed ln2; median dominant-site share of early variance is **99.32%**. Dominant sites 1/2/3 account for 10/13/9 tests. Averaging site log ratios dilutes that signal: family q95 becomes 0.5778, below ln2.

## Independent reconstruction and sensitivity

B's NumPy oracle imports no C code and learns no W25-specific rule. It reconstructs normal-only gates: max(ln2, 1.2 × maximum normal-fit prefix q95). Main's threshold is 0.7215976837; the six subflows use ln2=0.6931471806. C's proposed configuration uses at least eight observations/site, a 20-observation/site bound, scans every eight devices, at least 20 tests/family, 95% valid tests, at least three hits and two fresh passing scans. The 80-device dataset only reaches the memory bound; it cannot exercise later sliding windows.

W25 subflow-1 q95 progression at prefixes 32–80 is 0.5651, 0.8025, 0.5925, 0.4995, 0.4173, **1.4073632648**, **1.6177418909**. The pass at 40 resets at 48; passes at 72/80 produce a proposed alert at 80. Final normalized score is 2.3339, not a probability. Exact onset is unknown. An alert at the final device still needs final-message retrieval/delivery proof; G4 remains open.

| Wafer | Existing expected category | Proposed spread-down addition | Supporting tests |
| --- | --- | --- | ---: |
| W1 | site imbalance@32 retained | @56, subflow1 | 65/500 |
| W3 | low yield@32 retained | @40, subflow1 | 40/500 |
| W14 | mean up@32 retained | @64, subflow2; baseline already spread-down@64 | 110/500 |
| W18 | mean down@32 retained | @64, subflow3; baseline already spread-down@64 | 110/500 |
| W23 | spread up@40 retained | @64, subflow6; baseline spread-down@72 retained | 89/500 |
| W25 | baseline still misses | proposed @80, subflow1 | 32/500 |

The oracle appends these additions and preserves every original alert. W9 low yield@72 and W2's legitimate 53.75% yield/low-yield@32 remain unchanged. All **18 normal-labeled wafers** have zero additions: 2,4,5,6,7,8,10,11,12,13,15,16,17,19,20,21,22,24. Thirteen are fit wafers, so their zero-addition result is partly enforced by calibration. Full 25-wafer records, including baseline extra categories and duplicates, are in baseline.json, baseline-acceptance.json and pooled-oracle-acceptance.json. Hypothetical 7/7 coverage in that oracle is not accepted runtime coverage.

W1/W3 additional categories are mathematically supported but **not independently label-confirmed**. W1's 65 contributing tests are mostly site-4 dominated (54), median dominant early-variance share 92.53%. W3 has 40 contributing tests with median dominant-site share 99.57%. These can represent transient settling/isolated early extremes, which the synthetic failures below challenge. W14/W18/W23 additions duplicate existing categories; no baseline evidence was silently suppressed.

Ten sensitivity configurations (the proposed setting and nine one-factor variants) were evaluated without selecting a replacement. W25 is missed at **q80, q90, q97.5, q99**, with **mean-site-log q95**, or with **three-scan persistence**. Each quantile variant recalibrates on the same normal-only references. Margins 1.0/1.5 retain @80 because the ln2 floor dominates. One-scan persistence alerts at 40, but the vote does not persist at 48. Parameter sensitivity and overlapping-sample persistence prevent a robustness/generalization claim. Normal-only calibration does not remove method-selection bias after inspecting W25.

## Decisive rejected snapshot controls

Rejected C source SHA256: **9b5f530d47cf11ae6ee0009cb348b5101bae40a8332ebd32bdea3c347560aba8**. Exact source is preserved at round3/c-source-9b5f530d47cf11ae6ee0009cb348b5101bae40a8332ebd32bdea3c347560aba8.txt; it was unchanged during testing. The review uses B's documented synthetic calibration, not C's unfinished calibration builder. Normal-only arithmetic is independently checked above; this is not acceptance of a later C implementation.

Fixture: 24 identical related tests, four interleaved sites, per-site noise alternating ±2, 160 devices, baseline SD 2 and threshold ln2. Correlated test disturbances intentionally challenge the assumption that family votes supply independent confirmation.

| Control | Observed result | Decision |
| --- | --- | --- |
| No change; constant +100 mean offset; fixed site offsets | No alert | Pass |
| Noise scales to 5% after ten samples/site | spread_down@80 | Pass |
| Mean steps +100 after ten samples/site; noise unchanged | **spread_down@96** | **Fails frozen mean-shift gate** |
| Only global first-device value becomes 100; noise then unchanged | **spread_down@40** | **Robustness failure** |
| Missing/nonfinite whole site | Abstains | Pass |
| Extra wafer/label/future/bin keys | Identical results | Pass |
| 160 devices; repeated finalization; one-vote stop@72; finite extremes | Bounded state; no extra vote; no exception | Pass |

The mean step is later straddled by the early half of the sliding window, inflating early variance while the late half has only shifted steady noise. Pooling/q95 calls this reduced spread despite unchanged noise. The impulse case counts the same old disturbance in two overlapping scans. This is an executed negative result, not a hypothetical risk.

A's separate review compared all 1,225 scan statistics/thresholds with B's oracle, confirmed the same source hash, and reproduced 20/20 Gaussian mean-step failures plus B's step@96 and impulse@40. A-owned results/audit_r3_research.py and results/r3_research_review.json record that review.

**A accepted these failures as decisive rejection. No runtime/model/replay promotion is authorized; baseline stays 6/7 and W25 remains missed.** The source snapshot, controls and sensitivity evidence remain for future research. No machine, physical-unit, timeout, auth, transport, final-delivery or independent-validation gate closes.

## Checks and retained failures

**68 B tests pass:** 36 retained R1/R2 tests plus 32 new arithmetic, quality and acceptance tests. They cover causal suffix mutation, subject exclusion, missing/nonfinite/constant data, pooling versus mean log, normal-only gates, all 18 normal labels, W2, removed/delayed/duplicate alerts and output boundaries. Eight deterministic B diagnostic controls pass; these are separate from the rejected C snapshot controls. Command logs are round3-run.log, round3-challenge.log, round3-snapshot.log and round3-tests.log.

Two fixed implementation failures remain visible. The initial audit supplied NumPy scalar values to frozen runtime code, causing roughly 1e-15 arithmetic differences; Python float conversion restored exact equality without tolerances (round3-initial-run.log and round3/initial-failure-provenance.json). Initial tests exposed integer reference arrays rejecting assignment of NaN; converting references to float fixed that reusable path (round3-initial-tests.log). Final runs pass. C's negative controls remain rejection evidence.

All prior R1/R2 files except the current NOTES.md remain unchanged. Prior notes remain in accepted Git history. round3/inventory.json lists every retained file and its consumers; no cleanup deletion was authorized. A records implementation/publication SHA centrally after READY_FOR_A. B stops editing at handoff.
