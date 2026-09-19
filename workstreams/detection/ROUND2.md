# R2-20260919 — detector cost and site-key reuse

Recommendation: **DEFER runtime promotion**. This workstream evaluates one small
ingestion optimization and preserves production scan arithmetic and thresholds.
These measurements are local development evidence. A owns any future runtime
change and machine acceptance.

## Reproduction and frozen inputs

Base: a0d43172bbbdbde75fa1185d8037d4a35b787d4c, A's published R2 handoff.
Local branch: teammate-c-detection. Implementation: 382bfea362fc6eb664613d086dcb6697d9fb585d.
Run from the checkout root:

    python -B -m unittest discover -s workstreams/detection -p 'test_*.py' -v
    python -B -m workstreams.detection.profile_detector --output workstreams/detection/round2/profile.json
    python -B -m workstreams.detection.verify --contribution-ref 5f403bd
    git diff --check

The new stdlib CLI defaults to all 25 source_review/training/Data/*_RawResult.csv
files, grp6_app/artifacts/runtime.json and unchanged grp6_app.runtime.WaferDetector.
Historical evidence/baseline/summary.json is the exact alert oracle. No NumPy or
SDK is needed by the profiler; preserved R1 tests/audit still use NumPy.
Output is restricted to JSON files beneath workstreams/detection/round2, including
resolved-path checks against traversal/symlink escapes. This narrower output scope
also protects R1 evidence. --warmup defaults to 1 and --repetitions to 4, with
minimums 1 and 2 respectively. Original data/model/output evidence is never rewritten.

## Method and equivalence

Each wafer runs once per detector for warmup, then four measured pairs. The
baseline/candidate order alternates by wafer and iteration, balancing measured
order. Each run starts a fresh detector. All 80 device rows retain CSV order and
string site identity; only one wafer's input dictionaries are loaded at a time.

The sole candidate, SiteKeyDetector, lazily computes str(site) once per device
that has a valid measurement, then reuses the string. Production add performs
the conversion for every accepted feature. The candidate directly inherits
analyze: no changed floating-point operations, family gates, persistence,
thresholds, alert selection, series retention or evidence format. Stable string
and integer sites are covered; stateful custom __str__ objects are outside scope.

Every warmup/measured pair compares canonical JSON for the full per-call alert
trace, preserving numeric values and list order without tolerance. It also
compares hashes of the complete mutable final detector state. Repeated baseline
runs must match the first baseline, and all baseline alerts must equal the
retained R1 evidence. The profile retains full alert evidence once per wafer,
trace/state hashes and all measured raw timing samples for both variants.

Timing uses perf_counter_ns with normal GC. Ingestion covers add; scheduled scans
are every eight completed devices; active scans start at device 24; warming scans
at 8/16 and skipped checks are separate. Device total is add + analyze. Wafer
total includes constructor, all device calls, finalization and instrumentation
bookkeeping. CSV/JSON loading, state comparisons, graph-size traversal and output
I/O are excluded. Timer overhead is not subtracted. The profile uses median p50
and linearly interpolated p95 at .95*(n-1), and records maxima and sums.

This is an uncontrolled Windows desktop process with no affinity/priority change
or load isolation. Reported p95s describe the recorded sample population, not a
confidence interval. Warmup does not remove contention or cache/order effects.

## Measured findings

All 25 wafers / 2,000 unique devices pass exact alert category, position, evidence
and final-state equivalence in all 125 pairs (25 warmup + 100 measured). Every
baseline also reproduces R1 alerts exactly. Expected-category coverage stays
6/7; **W25 remains unfixed and has no alerts**. W2 retains low_yield@32 and measured
final yield 53.75%. No alert is added or removed. Full all-wafer evidence is in
[round2/profile.json](round2/profile.json); stdout is in
[round2/profile-run.log](round2/profile-run.log).

Milliseconds, excluding warmup repetitions. Each triple is p50 / p95 / max:

| Phase | Samples per variant | Production baseline | Candidate |
| --- | ---: | ---: | ---: |
| Ingestion per device | 8,000 | 1.307 / 2.231 / 40.044 | 1.245 / 2.114 / 41.029 |
| Scheduled scan, including 8/16-device warming | 1,000 | 76.294 / 98.961 / 136.652 | 75.918 / 98.793 / 138.774 |
| Active scan, >=24 devices | 800 | 81.266 / 99.944 / 136.652 | 81.443 / 99.641 / 138.774 |
| Device total | 8,000 | 1.387 / 82.393 / 138.359 | 1.325 / 82.578 / 141.884 |
| Finalization, no-op at device 80 | 100 | 0.0022 / 0.0042 / 0.0063 | 0.0021 / 0.0038 / 0.0098 |
| Wafer total | 100 | 770.289 / 867.195 / 954.581 | 772.231 / 844.368 / 1080.860 |

The profile separately retains constructor, warming-only and skipped-check
distributions plus every raw sample. Active scans consume **82.71%** of summed
baseline device time. The unchanged scan path therefore dominates this workload.

Median paired candidate/baseline ratios are 0.96325 for ingestion and 0.99139 for
wafer total: nominal reductions of 3.68% and 0.86%. Candidate wafer total is faster
in only 59/100 measured pairs; ratios range 0.87203–1.13495. Unpaired median wafer
time is slightly worse (772.231 vs 770.289 ms), and its maximum is worse. These
different summaries are both retained; they do not support a stable overall
improvement claim on an uncontrolled desktop. **Defer promotion**: the small
nominal ingestion saving does not resolve dominant scan cost or unbounded retention.
This limited result satisfies the assignment; it does not authorize a second
candidate or production changes.

Observed maximum retained mutable graph is **12,274,769 bytes (11.71 MiB)** at
80 devices: 3,035 tests, 242,800 global + 242,800 per-site sample references,
12,140 test/site lists, 80 yield values and at most 32 family-streak entries.
Per-test global/site series reach 80/20 values respectively. The candidate has
the same sample/list counts and no added retained field.

Environment: CPython 3.12.2 (64-bit), Windows-11-10.0.22000-SP0, AMD64 Family 23
Model 104 Stepping 1, 16 logical CPUs, GC enabled (700/10/10), QueryPerformanceCounter
resolution 100 ns. This differs from the supplied Python 3.10 container.
The profile stores all 25 CSV hashes, artifact/runtime/rehearse/historical-summary
hashes and both evaluated R2 source hashes, checked unchanged after execution.
The model artifact SHA256 remains
752e7c6c52b0c6e50a2c7ab37b7705ad21ec43ec18df968866832d07ba09afe9.
Raw source hashes include checkout line endings, as explicitly recorded; do not
mistake LF/CRLF checkout conversion for a behavior change.

## Retained state and limits

For D devices and T accepted baseline tests, the detector retains up to D*T
global sample references plus D*T per-site references, and D yield values. The
two measurement lists refer to the same ingested float objects. Test/site list
count is at most T*S for S distinct sites. Neither D nor S has an enforced cap
inside this class. The candidate adds no persistent state and does not fix growth.

A scan walks accumulated histories and sorts family metrics: approximately
O(D*T + T log T) per scan, with cumulative history traversal approximately
O(T*D^2/8) under the every-eight-device replay schedule. The code-level bound
does not establish a hard memory ceiling. New detector instances reset history;
SDK lifecycle/reset correctness is not proved by this profile.

Reported bytes are sys.getsizeof over the reachable mutable end-wafer object
graph, counting shared objects once. They exclude the frozen artifact, temporary
scan allocations, external retained alerts, preloaded CSV dictionaries and process
RSS. They are neither a measured allocation peak nor a deployment capacity limit.

All source wafers end at device 80, already analyzed: finalization is a no-op.
The synthetic 33-device test covers real residual finalization and exact final
low-yield evidence; it is not a representative performance measurement.

Native monitor callbacks can add multiple site results before emit_alerts; the
profile follows the per-device CSV rehearsal schedule. Native getters, feature
copying, models, locks, JSONL/report/export work and tester actions are excluded.
Desktop timings establish no SDK callback or TP deadline compliance. Physical
units, effective timeout, live transport/auth and machine receipt gates remain
open as documented by A in SYSTEM.md.

## Retention and verification

All 18 pre-existing C deliverables are retained. The R1 rejected spread-down
candidate and its two extra alerts remain historical evidence; it is not composed
with the R2 candidate. [PROPOSAL.md](PROPOSAL.md) remains unchanged. No new W25
fitting or independent holdout claim is made.

[round2/INVENTORY.md](round2/INVENTORY.md) inventories every workstream file and
its references. [round2/tests.log](round2/tests.log) records 20 passing tests
(11 preserved R1, 9 R2). [round2/historical-audit.log](round2/historical-audit.log)
records the passing immutable R1 evidence/contribution audit. R2 tests cover
differential per-callback state/alerts, invalid/missing values, integer/string
sites, residual finalization, repeated scans, measurement phase accounting,
growing retention/reset, exact-evidence mismatch rejection, output confinement,
percentiles and W2 CSV yield/order.

Post-write inspection recomputed every aggregate from saved raw samples, checked
all 29 input + 2 source hashes, all 100 paired final-state hashes and complete
25-wafer/2,000-device coverage. All passed. The profile command exited 0;
no source/test change followed that run. Authored paths and each contribution
commit are audited against the allowlist before publication.

No production code, artifact, shared config, VM or canonical document is changed.
A's next action is to review the profile/recommendation and record its disposition;
publication alone is neither integration acceptance nor deployment approval.
