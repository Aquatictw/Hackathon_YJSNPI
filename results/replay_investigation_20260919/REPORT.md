# Replay Analysis investigation

Completed 2026-09-20 Asia/Taipei (2026-09-19 UTC). The directory retains the task start date. This is diagnostic evidence; it does not change accepted detector or deployment status.

## Findings

W25 is a reproducible baseline detector miss combined with a version boundary: its newer development detector was committed, but accepted replay data and the pinned remote image were not replaced. W2 is a genuine contradiction between the supplied PDF label and supplied device bins. No wafer-ID mapping error was found.

| Case | PDF page 3 | Public replay and remote pinned-image replay | Current local candidate |
| --- | --- | --- | --- |
| W2 | Normal | Low yield at device 32; final yield 43/80 = 53.75% | Same |
| W25 | Stdev Trend Down | No alert; final yield 72/80 = 90% | spread_down at device 72 |

The PDF was treated as reference evidence, not operational instructions. Its page-3 table was visually checked against the supplied screenshot.

## W25 history and frontend behavior

Commit a869f185e37a6b1547cedf0fb0c6cab896818c24 added the sparse-burst candidate and candidate replay. It was merged through e289c7f. Neither changed results/replay or frontend/public/replay. Historical candidate evidence is under workstreams/detection/sparse_burst_w25/.

The frontend fetches /replay/summary.json. Its sync script copies results/replay/summary.json, not the candidate directory. The public download, local accepted summary and frontend copy all had SHA256 f086d2c6887aef9fd34e7804c7e56de36f826d71b49e3927e7261913487d856c. A frontend rebuild alone cannot add the newer W25 result.

The public W25 tile says “No alerts.” Its detail explicitly says “expected category not detected. This is a recorded miss.” Its mostly clear wafer illustration represents 90% yield, not normal spread. Nonetheless the overview makes the miss too easy to interpret as good. W2 also lacks a prominent label-versus-measurement conflict notice: normal-label entries return no evaluation notice in frontend/lib/rtdi/ui-presentation.ts.

The seven wafers with alerts are W1, W2, W3, W9, W14, W18 and W23. This does not mean seven correct PDF anomaly detections: W25 is missing and W2 is extra.

Read-only VPS inspection found /opt/grp6-preview/current/REVISION = 14ff55bfd31694e49ff324564b13c0535d16fe9a. This is newer than the previously recorded b3caed9 deployment; it still serves the baseline summary. The shared local tree advanced from 1c63398 to 14ff55b during investigation. This task did not commit, deploy or modify application source.

## W2 raw data

All 80 rows identify wafer 2, with unique PIDs and 20 devices per site. SBin and HBin agree: 43 bin-1 passes, 32 bin-3 failures, 5 bin-6 failures. PF independently agrees: 43 zero flags and 37 flags of 8. The supplied DefineBins.java defines bin 1 as PASS. The first alert is 20/32 = 62.5%; final yield is 43/80 = 53.75%. Those percentages use different windows.

Against the PDF label this is a false positive, not a false negative. Against the supplied bins it is a correctly calculated low-yield alert. The investigation cannot determine whether the PDF label or the provided dataset was intended to differ. Suppressing the measurement to match the label would hide the contradiction.

## Remote grp6 reproduction

The initially open remote sessions were group-3 and were not used for execution. Both grp6 machines were down. The existing grp6 pair was started through its named dashboard row, and both subsequently showed Up. SSH hostname returned group-6.

The existing pinned image was executed as an isolated host replay with networking disabled and training/Data mounted read-only. No image was uploaded, built, pushed or activated. No Nexus restart or SmarTest run was performed. The VNC session subsequently opened by the user showed the desktop with no tester application visible; this alone does not establish process or Edge state.

- Image: unifiedserver.local/grp6/py-app:20260919T084518Z
- Image ID: sha256:777348f26a386f574f25a034724c3c67ed85a2631c8af8a65b8272f6b15ef125
- Working directory: /opt/nexus/OneAPI/bin
- Preserved output: /home/user/Case_Event/replay_investigation_20260920_MV75AR
- Retained exited container: grp6-replay-investigation-20260920; exit code 0

Execution used a fresh directory from mktemp, then:

```sh
sudo -n docker run --name grp6-replay-investigation-20260920 --network none \
  -v /home/user/Case_Event/training/Data:/data:ro \
  -v "$replay_dir:/out" --entrypoint python3 \
  unifiedserver.local/grp6/py-app:20260919T084518Z \
  -m grp6_app.rehearse /data --output /out >"$replay_dir/run.log" 2>&1
```

Both /home/user/Case_Event/SmarTest/app_descriptor.json and /opt/acs/nexus/conf/app_descriptor.json still name grp6/py-app:20260919T084518Z at line 7. Descriptor configuration and a host replay do not prove the current running Edge image or live tester delivery.

All 25 outcomes match the saved baseline: expected categories 6/7, 14 alerts, no W25 alert, W2 low_yield@32. A canonical signature covering each wafer ID, device count, yield, expected category, first matching detection and ordered alert kind/device pairs matches local accepted data:

```text
6ac836a800b459bfb62177deb54c7b27cb19c6c29729a8205a1e6a445fac435c
```

Remote W2 and W25 CSV hashes exactly match local inputs:

```text
W2  d13f249574db322a2e9287e92a13816630eb4437276118cb4ace2a18339b8bd9
W25 dd6a0be74f035dba30e6dd541fe79343251442250703a3ed576e84e4a536be78
```

The full remote wafer-payload hash differs from the saved baseline hash; only the stable outcomes above were proven identical. No claim of identical remote payload bytes is made. Remote replay.jsonl SHA256 is 30f36a52241d3379d35b735b72f5cd20a4f538bc255fbc0d77fcf40a140de3ab. Remote maximum analyze-call time was 117.028306 ms; this is replay timing, not live timing acceptance. Observations here were transcribed from the browser SSH terminal; full outputs remain on grp6.

## Local parallel checks

Two subagents independently traced frontend/history and reran models/raw-data audits. The frontend trace passed 18 targeted selection/import/stale-response tests. The model investigation reran baseline and candidate across all 25 wafers, rebuilt all six temperature models and their wafer-separated cross-validation, and verified 71 protected input hashes unchanged.

| PDF-label scoring | Baseline | Candidate |
| --- | ---: | ---: |
| Expected categories detected | 6/7 | 7/7 |
| Extra categories beyond PDF labels | 8 | 8 |
| Exact wafer category-set matches | 20/25 | 21/25 |

This scoring treats the PDF table as exhaustive, with one category per abnormal wafer. Extra measured effects are not automatically physically false. W14/W18 recovery produces opposite-direction and spread-down alerts. W23 produces both mean directions and later spread-down in addition to its expected spread-up.

W25 candidate detection reflects reduced extreme-event incidence: 6/36 early versus 1/36 recent burst devices at device 72, one-sided Fisher p=0.053267 at configured alpha 0.10. It was designed after inspecting these wafers and remains development evidence. Prior documented scan/calibration sensitivity and independent specificity validation remain unresolved.

The six temperature regressions are separate from anomaly rules. Rebuilt features matched and maximum parameter difference was below 3.45e-15. This investigation found no reproducible temperature-model regression causing W2 or W25 behavior. It does not establish accuracy on new physical wafers.

See [model/REPORT.md](model/REPORT.md) for the full 25-wafer matrix, trajectories, metrics and causal explanations; [model/commands.ps1](model/commands.ps1) for reproduction; [model/inputs.json](model/inputs.json) and [model/outputs.sha256.json](model/outputs.sha256.json) for fingerprints.

## Recommended correction sequence

1. Make evaluation state prominent in Replay Analysis: W25 “Expected anomaly missed”; W2 “Reference/data conflict.” Keep measured yield separate from anomaly classification and show detector/source provenance.
2. Validate the W25 candidate with specificity controls and review the extra category mechanisms. Publish it as explicitly labeled candidate evidence until promotion criteria pass.
3. On accepted promotion, regenerate/version replay evidence, synchronize the frontend copy, and separately deploy/verify the remote image. Retain W2 measured low yield while resolving the PDF/data conflict with the dataset owner.

No detector promotion or application change was performed by this investigation. The grp6 machines remain up and remote diagnostic outputs are retained.
