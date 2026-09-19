# grp6 deployment and rehearsal

User uploads grp6_deploy.zip into /home/user/Case_Event. In grp6 SSH:

    unzip -q grp6_deploy.zip -d grp6_release
    python3 grp6_release/install_grp6.py --build --push

The installer verifies checksums, copies the supplied SDK into a timestamped
build directory, changes only its staging main.py, builds a versioned image,
runs tests in the image, constructs the actual SDK Monitor, then pushes the
version and grp6/py-app:latest. It preserves original files and old images.
Record the generated grp6_deployment_latest.json and image digest.

Use the supplied SmarTest workflow on grp6. The descriptor already points to
grp6/py-app:latest. runTp.sh copies that descriptor on every invocation.
load/prod_run restart SmarTest via startSmt.py; use only for the intended
rehearsal. Do not restart Nexus. If SmarTest is already loaded, start the app
with /opt/acs/nexus/bin/AppDeployer start, then run a controlled engineering
touchdown with bash runTp.sh eng_run 1 in Case_Event/SmarTest.

In Edge/code-server inspect the actual app/container logs. Verify lot/wafer,
active sites, mapped measurements and prediction_request stages 1..6 with
status=response_queued and coverage=1.0 on every active site. Then verify
tester GDR logs / MessUI contain those predictions. Queueing alone does not
prove receipt. Run simulated production with the app ready before lot start;
observe an anomaly message at the tester. Preserve the corresponding alert,
action_message, test/site/wafer, plot and tester receipt evidence.

Live files: /tmp/grp6_evidence.jsonl and /tmp/grp6_evidence.html. Reports
refresh asynchronously every 32 devices and at boundaries. Preserve files
before the container exits; user handles downloads. Set GRP6_EVIDENCE to a
writable persistent volume if available. Generate a report manually with:

    python3 -m grp6_app.report /tmp/grp6_evidence.jsonl --output report.html

## Replay fallback

Bundled results/replay/report.html is a self-contained replay report, not
live acceptance. Re-run inside the built image with training data mounted:

    sudo -n docker run --rm --entrypoint python3 -v /home/user/Case_Event/training/Data:/data:ro -v /home/user/Case_Event/grp6_replay:/out IMAGE -m grp6_app.rehearse /data --output /out

Create the output directory first; use the versioned image from deployment
JSON. Replay requires no SDK connection or NumPy. Sensor units/scaling and
actual feature coverage remain live checks. Review replay limitations and
missed labels in the included report before presenting results.
