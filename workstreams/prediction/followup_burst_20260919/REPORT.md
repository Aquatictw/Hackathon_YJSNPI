# B independent sparse-burst follow-up — R3-20260919

**READY_FOR_A. The note strengthens the sparse extreme-event diagnosis, but does not establish a valid spread-decrease detector.** Its central factual claims reproduce with normal-fit-only references. The fixed B audit rule misses W25, flags normal-labeled W15, and confuses an unchanged-noise mean returning to baseline with a spread decrease. C's separately developed method requires its own review. No runtime/artifact/replay/deployment promotion; accepted baseline remains **6/7, W25 missed**.

This is same-round research, not acceptance. All new B files are in workstreams/prediction/followup_burst_20260919/. startup.json records starting shared-main HEAD fca8912da03db0f00db94ff990e59f4d32bade4a, the note's exact SHA256 and all56 pre-existing B file hashes. validation.json verifies their preservation. A owns publication; B performed no Git mutation, browser/SSH/VNC/live action, agent spawning or paid API call.

## What the note gets right

The reference is preserved byte-for-byte as reference-message.txt. Its instructions were not adopted as authority; the user's narrower B assignment governs. B independently parsed the25 CSV blobs and runtime artifact at assigned R3 base810b4ac9549a619ab09e9145f656c363c6d75035. No C implementation was imported.

For all six500-test subflows, fit a separate median and MAD for each site/test on the inherited normal-fit wafers **2,4,5,7,8,10,11,13,16,17,19,20,22**. Each site/test has260 reference observations. Use absolute deviation divided by1.4826*MAD; z>20 in at least four tests defines one burst device. The fallback is IQR/1.349, then population SD; entirely constant, missing or insufficient reference samples abstain. The actual reference scale-method counts are in audit.json and exact reference values in normal-reference.json.gz. Current-wafer observations never enter this fitted reference.

W25 subflow1 bursts occur at **devices/PIDs5,6,17,18,19,35,38,78**, with **5,5,5,4,5,5,5,5** extreme tests respectively. Sites are1,2,1,2,3,3,2,2. Thus **7/40 early versus1/40 late** reproduces. Each test's raw value, reference median, MAD, scale and robust z is retained in burst-evidence.json, for every burst on all25 wafers. The rate difference is15 percentage points. These are eight device events, not39 independent test events.

Both scaled-MAD and raw-MAD conventions reproduce the same eight W25 events at the note's settings. A separate whole-wafer self-fit gives the same counts but is explicitly NONCAUSAL and is not used by any sequential score. Agreement with a leaky diagnostic does not authorize its online use.

The note's baseline score also checks out: independently reconstructed subflow1 mean-site-log family q80 at device80 is **0.18625320746848095**, below threshold **0.3576668075747554**; all scheduled prefixes remain below the gate. claim-checks.json records all seven values. Together with the prior R3 dispersion evidence, this supports sparse extreme events rather than a broadly reduced family SD. It does not establish physical cause, onset, or measurement validity.

## Sequential evidence and the normal-wafer counterexample

B froze an audit rule before the all-wafer run: equal halves of the completed-device prefix, scans32..80 every8, minimum four early burst events, one-sided conditional Fisher upper-tail score -log10(p), and two adjacent passing scans. This is an independent testable interpretation of the note, not a claim that it specifies one unique algorithm. Invalid devices cause the affected prefix/family to abstain. All inputs end at the scanned prefix.

| W25 prefix | Early/late events | Unadjusted fixed-table p |
| --- | --- | --- |
|32|2/3|0.833704|
|40|5/2|0.203742|
|48|5/2|0.207900|
|56|5/2|0.210776|
|64|5/2|0.212883|
|72|6/1|0.0532670|
|80|7/1|0.0283793|

At nominal p<.05, only the final W25 scan passes: **no two-scan alert**. Normal-only calibration takes the largest score over all six families and seven scans on the13 fit wafers, plus an epsilon, with a nominal .05 floor. Both the ordinary and leave-one-normal-wafer-out reference calculations have maximum **1.262728387482898**, from W19 subflow1@48 (4/24 versus0/24, p=.0546099). The .05 floor sets the final score gate to **1.3010299956639813**. This empirical envelope covers supplied fit-wafer scans; it is not an out-of-sample false-alarm guarantee.

With either reference-calibration calculation, the rule adds **W15 subflow1@64**, with5/32 early and0/32 late, p=.0264117. This is **one of18 normal-labeled wafers**; none of the13 fit wafers add alerts. W6,W12,W21,W24 have none. W15 and those other four wafers were previously inspected, so this is a development-data counterexample, not an independent holdout estimate. All25 wafer records, original baseline alert payloads, all family counts, scan results and supplementary proposals are in audit.json. W2's legitimate low-yield alert and other expected baseline categories remain present in the copied immutable baseline records; B did not run or modify a new production replay.

A simple42-comparison Bonferroni sensitivity uses .05/(6 families*7 scans), score **2.9242792860618816**. It produces neither W25 nor extra normal-label alerts. The p values themselves assume exchangeable independent device events; related temporal bursts may violate that assumption. Conditioning on site counts barely changes W25 p72/p80 to.0533279/.0271305. Multiple-scan correction does not resolve source classification. Adjacent overlapping scans are not independent confirmations.

**A common threshold cannot rescue W25 while excluding W15 under this fixed score and rule.** W25's best adjacent-pair weaker score is1.2735414443 (ending80); W15's is1.5782043422 (ending64). Any threshold low enough for W25 also admits W15. A clearly labeled, postdeclared calculation removing the .05 floor demonstrates this: normal-envelope-only gate1.2627283875 yields W25@80 **and W15@64**. It is a diagnostic counterfactual, not a selected replacement.

Six disclosed sensitivity configurations vary z10/20/30/40 and minimum tests2/4/6 without selecting a winner. None supplies W25 under the primary nominal-floor/two-scan rule. z10 adds W1/W14/W18 as well as W15; z30 adds W23 as well as W15; minimum6 or z40 adds nothing. Every configuration recalibrates its numerical gate on normal-fit wafers only. No further search was performed.

## Specificity controls

Fixture:80 devices, four sites,24 related tests, unchanged per-site alternating +/-1 noise, fixed reference center0 and scale1.4826. Burst disturbances affect four correlated tests unless otherwise stated. Windows, minimum counts and persistence match the data audit. Reported positions below are completed-device counts.

| Control | Nominal/normal-envelope result |42-comparison result|
| --- | --- | --- |
|No change; constant mean offset; one extreme test|No alert|No alert|
|Stable10-to10 bursts; increasing0-to10 bursts|No alert|No alert|
|Decreasing10-to0 bursts|Alert@72|No two-scan alert|
|One isolated correlated impulse|No alert|No alert|
|Five early correlated impulses|Alert@40|No alert|
|Mean moves away from reference, noise unchanged|No decrease alert|No decrease alert|
|Mean returns from+100 to0, noise unchanged|**False spread interpretation@56**|**@64**|
|Only four correlated test means return, noise unchanged|**Same failure@56**|**@64**|
|Site1 has fixed burst rate; site exposure changes|**False decline@48**|**@56**|
|Missing site|Abstains|Abstains|

A mean returning to the reference reduces absolute reference deviations without reducing within-regime noise. Both halves have the same per-site noise variance in these controls. More stringent count significance cannot distinguish this from a burst-source decline. Four coincident tests do not supply four independent observations. Minimum early-event counts fix the single-impulse example from rejected R3, but five early impulses still provide overlapping-window votes. Whether isolated early transients are desirable detections requires an explicit target definition; they are not proof of sustained noise reduction.

A balanced-site-exposure guard blocks the constructed site-mix confound, but does not fix the mean-return failure. Fixed site offsets represented in the reference are correctly removed. All supplied wafer scan halves have balanced site counts, so the simple site-mix guard does not separate W15 from W25.

An additional fixed-seed stationary single-family Bernoulli burst stress used1000 trials each at rates.05/.10/.20, treating four test hits as one event. Nominal two-scan alerts occur in4/20/28 trials respectively;42-comparison alerts in0/1/0. These are defined synthetic rates, not measured wafer false-positive probabilities or evidence of six-family independence. All14 deterministic fixtures and all3000 trials are retained in controls.json.

## Leakage and acceptance limits

1. **Normal numerical fitting is necessary, not sufficient.** The sparse-burst framing, z20, minimum4, and emphasis on W25 arose after observing W25. Normal-only medians and gates do not undo method-selection reuse. All25 wafers are development evidence.
2. **Training and calibration reuse remain explicit.** Ordinary fit-wafer scores reuse their own observations in the reference. Leave-one-normal-wafer-out removes that direct inclusion, but all13 scores still determine their shared envelope. Neither is independent validation or a calibrated guarantee from13 wafers.
3. **Site/test and time handling are causal only under fixed references.** Per-current-wafer full-history median/MAD leaks future observations. Device event counts must retain missingness and site exposure; unknown sites/nonfinite values must not become zero-event evidence.
4. **Burst decline and spread decline need distinct semantics.** Mean returns, correlated disturbances and changed exposure can reduce exceedances. Success on W25 alone cannot validate a general spread detector. These controls challenge the B interpretation and any method sharing these assumptions; they are not an execution audit of C's new code.
5. **The prior rejection remains intact.** No production/runtime/artifact changes, live testing, callback-cost claim, final-message delivery claim or independent validation. A coordinates acceptance; C independently assesses feasibility.

## Reproduce and verify

From repository root, use the existing Python/NumPy environment. The audit reads exact R3 Git blobs, requiring that commit locally; it never fetches. Default output is this follow-up folder. Use a fresh child folder to avoid overwriting this record. The claim checker reads the preserved primary audit.json explicitly.

    python -B -m workstreams.prediction.followup_burst_20260919.audit_bursts --output workstreams/prediction/followup_burst_20260919/recheck
    python -B -m workstreams.prediction.followup_burst_20260919.check_claims --output workstreams/prediction/followup_burst_20260919/recheck
    python -B -m unittest discover -s workstreams/prediction/followup_burst_20260919 -p test_*.py -v
    git diff --check

**24 follow-up tests pass.** Coverage includes exact-tail arithmetic, excluded-wafer fitting, zero-MAD fallback, missing/unknown sites, fixed-site offsets, one versus four correlated extremes, isolated impulse, mean-return failure characterization, stable/increasing/decreasing bursts, future-suffix invariance, minimum sample count, stateless wafer reset, site-mix guard, symmetric families and output scope. The earlier68 B tests were already passing and are reused for unchanged prior code; they were not rerun or rewritten. Passing characterization tests do not make the method acceptable.

audit-run.log, claim-checks-run.log and tests.log preserve executed results. validation.json records final source/output hashes, command outcomes, note/input identities, exact changed paths and all56 pre-existing B hash comparisons. inventory.json lists every follow-up file and its role; startup.json retains the complete prior B inventory. No unsuccessful R3 evidence or snapshot was replaced. B stops editing after READY_FOR_A; publication belongs to A.
