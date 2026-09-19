# B independent burst audit: diagnostic confirmed, detector not established

R3-20260919 follow-up; reference message SHA and immutable input identities are in startup.json/audit.json. Prior R3 evidence remains untouched.

- Normal-fit-only site/test median and 1.4826*MAD, z>20, at least four tests per device/family reproduce W25 subflow1 bursts at devices **5,6,17,18,19,35,38,78**: **7/40 early, 1/40 late**, each with four or five extreme tests. Whole-wafer self-fit is unnecessary for this observation.
- Equal-prefix-half one-sided Fisher p is **0.0532670 at72**, **0.0283793 at80**. A p<.05/two-scan rule therefore misses W25. Six families times seven scans gives42 scheduled comparisons; the simple Bonferroni cutoff .05/42 is not met. These p values also assume event exchangeability.
- Normal-only maximum-scan calibration with a .05 floor, using either full-fit or leave-one-normal-wafer-out baselines, gives **one extra normal-label wafer: W15 subflow1@64** (five early bursts, zero late). W6/12/21/24 have no additions; these five wafers were previously inspected and are not holdouts.
- Unchanged additive noise with mean returning from+100 to baseline yields a false spread interpretation at56, even at64 under the42-test correction. Four perfectly correlated test transitions have the same failure. Changing site mix produces a false decline at48; requiring balanced site exposure blocks that example but not the mean transition.
- One isolated impulse is suppressed by the minimum-four-early-events guard; five clustered early impulses still alert@40. Stable/increasing burst fixtures do not alert; decreasing10-to0 does@72 nominally. This improves one R3 impulse case without establishing a general spread detector.

Read audit.json, burst-evidence.json and controls.json for all25 wafers, scan tables, raw extreme-test evidence, calibration scope and deterministic controls. Twenty-four B follow-up tests pass; final report/manifest are being packaged. No runtime/artifact/deployment edits or promotion.
