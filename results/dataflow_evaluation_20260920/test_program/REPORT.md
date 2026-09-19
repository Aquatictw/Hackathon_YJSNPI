# Supplied test-program evaluation — local independent review, 2026-09-20

**Result:** the supplied source confirms the ORE configuration entry point, but the actual simulator input files and their independence from training are **unknown**. Existing production evidence supports a reproducible 480-pair sensor error evaluation and three emitted anomalies; it does not establish independent holdout accuracy, anomaly precision/recall, or successful anomaly display. No remote/browser, application, Git, or model operation was performed. All authored files are in this directory.

## 1. Confirmed source path; missing provenance

All source paths below are repository-relative.

| Evidence | Confirmed behavior / limit |
| --- | --- |
| `Case_Event/SmarTest/workspace/projects.map` | Maps logical `TestCase_Smt870` to `/home/user/Case_Event/SmarTest/Case_Smt870`. Local Java/flow review copy is under `source_review/SmarTest/Case_Smt870`. |
| `Case_Event/SmarTest/Util/startSmt.py:51-52` | Selects `TestCase1_4site_ft.prog` and `acs_tcct_4site_ft.xml`. These two files are absent from the scoped local trees. |
| `source_review/SmarTest/Case_Smt870/src/TestCase1/TestCase1_Prebind.flow:15-28` | Executes `ReadOreDef`, setting `Offline_Data_Def_File = src/TestCase1/TestCase1_OfflineData.csv`; pattern default is `patfaildef.csv`. Delay override is commented out. |
| `source_review/SmarTest/Case_Smt870/src/ACSTML/T_LoadOREDef.java:8-13` | Calls `libACS.ORE.Util.LoadORESetup(definition, pattern, delay, context)`; default delay file is `delay.csv`. The loader implementation is absent. |
| `source_review/SmarTest/Case_Smt870/src/TestCase1/TestCase1_PreRun.flow:20-28` and `src/ACSTML/T_ORE_Build.java:16-56` | If `run_ore` is true (default true), activates ORE; fetches suite delays and simulated DUTs; FT sets X/Y, lot and wafer from those DUTs. |
| `source_review/SmarTest/Case_Smt870/src/TestCase1/Main.flow:451-468` | Requests stage N before sensor N, then executes subflow N; six stages. Sensors use `CustomTML.ContiTest`, measurement execution/result access, not the `sim_result` random integer. |

The expected machine location of the definition, using the recorded project mapping, is `/home/user/Case_Event/SmarTest/Case_Smt870/src/TestCase1/TestCase1_OfflineData.csv`. **This is a configured candidate path, not a verified opened file.** Library path resolution, referenced data paths, row selection, wrap/repeat behavior, transformation and generation procedure cannot be inferred without the missing definition/library/configuration. Neither the definition, recipe, `.prog`, nor ORE library is in the 66-entry `grp6_sources_data.zip`; they are also absent from local `Case_Event` and `source_review/SmarTest`, including ignored files. The older partial full-package extraction is not used as authoritative evidence.

Recorded machine events identify `group-6 / B13456 / 02`, whereas the 25 training CSVs identify lot `A12345`. The engineering tester report identifies the FT program and `B13456 / 02` at lines 5, 17, 23-27. Production tester text lines 9538-9550 records `PreRun.PreparOre`, `ACSTML.T_ORE_Build`, `B13456` and `SetSimResult`. These observations support simulator use; different lot names do not prove independent data. `source_mode=live` describes the SDK transport, not physical measurements or independent generation.

`data_overlap.json` compares all six sensor targets per production device against all 2,000 rows of the 25 training CSVs, ignoring identity and converting CSV values to IEEE754 binary32 to match SDK numeric precision. **0/80 exact vector matches.** This excludes exact six-target-vector reuse under that comparison, not transformed reuse, feature reuse, shared generation or statistical dependence. All **24/24 engineering predicted/actual pairs exactly equal the first production touchdown**. Do not pool them as 504 independent accuracy samples.

`SetSimResult.java:16-29` generates a per-site random integer in `[0,100)`; `Main.flow:469-473` conditionally adds bin 30 using `fail_rate`, then adds bin 1. The stored production bins are 74 in bin 1, four in bin 6, two in bin 32, none in bin 30. Therefore random-bin code is a source capability, not proof that these six failures were randomly injected. Live `fail_rate`, bin priority and original ORE labels remain unknown.

## 2. Existing production error and delivery evidence

Input: `results/vm_production/grp6_core_prod3_evidence.jsonl`, SHA256 `dcd2fda6e8b09dd9fb51f9c713098c756abd1d24caece813a709af6bcd8fa4af`. Run `d132133657be459e8e97b6fd442142e2`, model `752e7c6c52b0c6e50a2c7ab37b7705ad21ec43ec18df968866832d07ba09afe9`. Historical September 19 evidence; no current deployment assertion.

| Sensor/stage | Pairs | MAE | RMSE | Mean predicted − actual | Worst absolute error |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 / CP | 80 | 0.378586 | 0.504142 | +0.378586 | 1.902679 |
| 2 / DS0 | 80 | 0.094628 | 0.154249 | +0.094560 | 0.651228 |
| 3 / IO4 | 80 | 0.098214 | 0.099966 | −0.098214 | 0.143870 |
| 4 / IO1 | 80 | 0.064507 | 0.068718 | +0.064507 | 0.125159 |
| 5 / IO2 | 80 | 0.515294 | 0.520963 | +0.515294 | 0.653074 |
| 6 / IO3 | 80 | 0.146822 | 0.165370 | +0.146822 | 0.471400 |
| Overall | 480 | **0.216342** | **0.313958** | **+0.183592** | **1.902679** |

Units are the recorded numeric sensor units: actual events have `unit=null` and `observed_csv_units_unverified`. No Celsius or accuracy pass threshold is established. The `validation.metrics` embedded in the old summary are training-data five-fold results, **not the production errors above**.

Worst pair: stage 1, site 4, part 20, touchdown 5; predicted `35.44168003932194`, actual `33.53900146484375`; request `134d55f2b97d4ad0b18534657df95a1e`, request sequence 166, actual sequence 193. The pair CSV retains all event/request/device identities.

Independent checks: 765 unique event IDs and continuous sequence 1–765; 120 requests, 80 device IDs, four sites, six targets per device, all 480 strict joins; selected-feature coverage 1.0 throughout. Join key includes run, tester, lot, wafer, test, stage, request, site, prediction ID and device ID. It checks source mode/model equality, request sequence before actual sequence, and exact agreement of stored versus recomputed prediction/error. This validates recorded joins; it cannot recover unsampled feature timing.

Prediction callback latency is 0.364025–8.349962 ms, with 18 waits. This is not tester end-to-end time: the first tester receipt has Nexus process time 106 ms and adaptive execution time 154 ms. `prediction_receipts.json` independently matches all **120 parsed response JSONs** to distinct tester lines and adjacent `Exec Pass: 1 Exec Fail: 0`. Core request IDs are assigned by matching exact content, not echoed by the tester.

Engineering has 24 joined pairs, MAE 0.192432 and RMSE 0.260251, entirely repeated by production touchdown 1. Its evidence SHA256 is `274c1892e177dc6834bfd6931b8924c560e53fb9a5f367766434591fbedb4da3`.

## 3. What anomalies can be quantified

Production completes 80 devices in 20 touchdowns, 74 pass / six fail, yield 92.5%. It emits three alerts, all at completed device 32:

| Alert ID prefix / sequence | Kind / site / test | Observed / reference | Score |
| --- | --- | --- | ---: |
| `bbe24a7975e6` / 311 | site imbalance; site 1 vs 3; `21340_Main.subflow3.Flow3_Suite39#CP` | 1.908375 / 1.334875 | 4.462907 |
| `7d9bfbbb7dd9` / 313 | mean up; site 3; `28380_Main.subflow3.Flow3_Suite391#CP` | 1.471500 / 1.181250 | 2.388889 |
| `60d64c90b080` / 315 | mean down; site 4; `28900_Main.subflow3.Flow3_Suite417#CP` | 1.324500 / 1.442000 | 1.058559 |

Scores are detector statistics, not correctness probabilities. `production_metrics.json` preserves the full alert windows, baselines, thresholds and site series. Only 12 raw measurement samples were logged; the run's callback counter records 242,480 measurements. This JSONL cannot support a full independent rescan of every test or missed anomaly. Without B13456/02 ground truth/onset, precision, recall, false positives, missed anomalies and detection delay from onset are unknown. Device 32 is emission position, not delay from known onset. Training-wafer labels (including A12345 W02) must not be assigned to B13456/02.

All three `action_message` events report setter success and all IDs appear in the sequence-319 `get_prod` response. Strict parsing independently reproduces **invalid JSON at column 256**, a literal control character. Thus zero recorded `*_error` events is not a passing delivery gate. The existing transcribed `results/vm_production/receiver_observation_20260919.json` reports arrival at TCCT On_POSTBIN for all three IDs; original receiver logs remain remote. It explicitly leaves parsing/execution/display and final-boundary delivery unverified. The later pinned JSON-fix deployment is separate evidence and does not retroactively repair run 3.

## 4. Exact launch behavior and parent-only observations

The only fully reproducible **local, non-live** command needed for this review, from the repository root, is:

```powershell
python -B results/dataflow_evaluation_20260920/test_program/evaluate.py
```

It uses the standard library, imports no application/model code, reads retained source/evidence/training CSVs and writes only beside itself.

| Supplied launcher | Side effects established locally |
| --- | --- |
| `bash runTp.sh load` | Copies descriptor to `/opt/acs/nexus/conf/app_descriptor.json`; recreates workspace; kills SmarTest and TCCT; loads offline FT program and attempts AppDeployer start up to six times. |
| `bash runTp.sh eng_run 1` | Also overwrites descriptor; invokes `/opt/hp93000/testcell/bin/run <SmarTest>/Util/tpExec 1`. `tpExec` is a Linux ELF binary; not executed here. |
| `bash runTp.sh prod_run` | Also overwrites descriptor, recreates workspace, kills SmarTest/TCCT, then executes `tcct -m -r <SmarTest>/recipe/acs_tcct_4site_ft.xml`. A second argument is ignored. |

**No production recipe can be certified safe from these local files.** SYSTEM records that production run 3 used an already-bound recipe to avoid teardown; the bound recipe's exact filename/content/command is not retained here. The supplied launcher's concrete command is `/opt/hp93000/testcell/bin/tcct -m -r /home/user/Case_Event/SmarTest/recipe/acs_tcct_4site_ft.xml`; this documents behavior, not an instruction to execute it in a healthy session. A bypass of `runTp.sh` alone does not prove the recipe avoids session recreation. Do not claim `prod_run 1` means one bounded run.

Parent's first observation can use these **read-only** commands on the verified `group-6` VM (not run by this reviewer):

```bash
hostname
date -u
cat /home/user/Case_Event/SmarTest/workspace/projects.map
readlink -f /home/user/Case_Event/SmarTest/Case_Smt870/src/TestCase1/TestCase1_OfflineData.csv
sha256sum /home/user/Case_Event/SmarTest/Case_Smt870/src/TestCase1/TestCase1_OfflineData.csv
sed -n '1,160p' /home/user/Case_Event/SmarTest/Case_Smt870/src/TestCase1/TestCase1_OfflineData.csv
find /home/user/Case_Event/SmarTest -type f \( -name '*.xml' -o -name '*.prog' -o -name '*Offline*' -o -iname '*ore*' -o -name '*.jar' -o -name 'patfaildef.csv' -o -name 'delay.csv' \) -print
sed -n '1,240p' /home/user/Case_Event/SmarTest/recipe/acs_tcct_4site_ft.xml
sed -n '1,200p' /home/user/Case_Event/SmarTest/Case_Smt870/src/TestCase1/TestCase1_4site_ft.prog
find /home/user/Case_Event/training/Data -maxdepth 1 -type f -name '*.csv' -exec sha256sum {} +
```

Observe these five evidence groups before declaring live acceptance:

1. **Data identity:** retain the complete resolved ORE definition and every referenced backing file's realpath, bytes, SHA256, schema, lot/wafer/row range and selection parameters; inspect the actual loader/classpath and any transformation/random seed. Compare source hashes and values with the training manifest here. First-160-line output is inspection only, not a complete archive. Independence requires confirmed generation/partition lineage as well as no duplicate data.
2. **Recipe/session identity:** record actual loaded program and workspace, effective `run_ore`, `stage`, `fail_rate`, active sites, current bound/idle state, recipe content and its session/bind/loop/device-count steps. Identify the recorded already-bound recipe before selecting an execution command; retain descriptors and current logs. Never restart Nexus during SmarTest.
3. **Runtime identity:** observe actual Edge container image/tag/digest and fresh Monitor model hash; correlate them with the immutable release. This local review neither verifies today's image nor promotes the new W25 source candidate.
4. **Accuracy/timing:** retain SDK values with unit/scaling/flags, all request/actual identities, complete lot boundaries and tester receipts; establish actual timeout units/deadline and externally specified accuracy tolerance. Preserve periodic Edge logs (five-second snapshots worked in run 3). No new lot is needed merely to reproduce the historical error calculation.
5. **Anomaly truth/delivery:** obtain simulator scenario labels and onset separately from detector output. Correlate IDs across set_message, strictly valid get_prod, On_POSTBIN parser/execution and Message Center, including a poll after final-boundary emission. Preserve both receiver clock values until alignment is verified.

## Artifacts and validation

`prediction_actual_pairs.csv`: 504 rows labeled production (480) or engineering (24), with signed/absolute errors and source IDs. `production_metrics.json` and `engineering_metrics.json`: counts, bins, per-stage/per-site metrics, alert payloads and parsing results. `prediction_receipts.json`: 120 independent tester content/execution matches. `data_overlap.json`: training-vector comparison and engineering repetition. `input_manifest.json`: exact bytes/SHA256 for 73 local inputs, including reviewed source trees and all training CSVs. `evaluate.py`: reproduction method.

The evaluator completed successfully with strict identity/uniqueness/order/error assertions and 120 unique receipt matches. Its generated input hashes agree with the canonical production and engineering evidence hashes. No model fitting, simulator execution, production request, app mutation or Git command was used.
