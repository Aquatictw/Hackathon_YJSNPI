# grp6 RTDI test assistant

Production entrypoint: grp6_app.live_main.main(). monitor.py registers the SDK Monitor, keeps current-touchdown/site state and sends one prediction N: prefix containing all active site/value pairs via set_wait then get. Alerts call required set_message. Queueing is not proof of tester receipt.

Run local checks: python -m unittest discover -s grp6_app/tests -v
Run replay: python -m grp6_app.rehearse source_review/training/Data
Training: python -m grp6_app.build_models source_review, then python -m grp6_app.calibrate

Runtime/replay use Python standard library; training needs NumPy. Supplied SDK uses Python 3.10. Six flow-derived allowlists exclude future measurements and all sensor targets. Selection occurs inside five wafer-separated validation folds.

Anomalies combine per-test normal thresholds with agreement across related test suites. Low yield uses SBin=1 PASS, below 80%, at least 32 devices, and a one-sided 95% Wilson upper bound before wafer end. Normal check wafers were inspected during development and are not independent validation. W2 is labeled normal but has measured 53.75% yield. W25 spread decrease is currently missed.

Live logs default to /tmp/grp6_evidence.jsonl, with an asynchronous companion HTML report. Preserve files before container removal. First measurement samples include units/scaling; no scaling is guessed.

Old adapter/train/replay modules are legacy experiments and excluded from the deployment package. Read bundled RUNBOOK.md. Require actual VM measurements, feature coverage, prediction receipt and tester anomaly message before claiming live completion.
