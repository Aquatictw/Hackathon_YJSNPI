"""Create a selective, verified stdlib runtime bundle."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ACCEPTED_RUNTIME_SHA256 = '752e7c6c52b0c6e50a2c7ab37b7705ad21ec43ec18df968866832d07ba09afe9'
RELEASE_ARTIFACTS = ('runtime.json', 'manifest.json', 'validation.json')

def main(output=None):
    files = {}
    for name in ["__init__.py", "state.py", "runtime.py", "monitor.py", "live_main.py", "exporter.py",
                 "report.py", "data.py", "metadata.py", "rehearse.py", "sparse_burst.py"]:
        files["grp6_app/" + name] = (ROOT / "grp6_app" / name).read_bytes()
    for name in ["test_state.py", "test_monitor.py", "test_report.py", "test_exporter.py"]:
        files["grp6_app/tests/" + name] = (ROOT / "grp6_app/tests" / name).read_bytes()
    # runtime.py imports sparse_burst.py, but its optional calibration must NOT
    # enter this transport-only release. Never discover release artifacts by glob.
    for name in RELEASE_ARTIFACTS:
        path = ROOT / 'grp6_app/artifacts' / name
        files["grp6_app/artifacts/" + path.name] = path.read_bytes()
    if hashlib.sha256(files['grp6_app/artifacts/runtime.json']).hexdigest() != ACCEPTED_RUNTIME_SHA256:
        raise ValueError('Transport release requires the recorded deployed runtime artifact')
    for name in ["README.md", "SYSTEM.md"]:
        files[name] = (ROOT / name).read_bytes()
    for name in ["install_grp6.py", "audit_evidence.py"]:
        files[name] = (ROOT / "deploy" / name).read_bytes()
    for name in ["summary.json", "report.html", "replay.jsonl"]:
        files["results/replay/" + name] = (ROOT / "results/replay" / name).read_bytes()
    digests = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    files["SHA256.json"] = json.dumps(digests, indent=2).encode()
    target = Path(output).resolve() if output else ROOT / "grp6_deploy.zip"
    # Release archives are immutable evidence; require a fresh destination.
    with zipfile.ZipFile(target, "x", zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    with zipfile.ZipFile(target) as archive:
        if archive.testzip() is not None:
            raise ValueError('Package CRC verification failed')
        for name, digest in digests.items():
            if hashlib.sha256(archive.read(name)).hexdigest() != digest:
                raise ValueError('Package checksum verification failed: ' + name)
    print(str(target), target.stat().st_size, hashlib.sha256(target.read_bytes()).hexdigest())

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', help='Output ZIP path; defaults to grp6_deploy.zip')
    args = parser.parse_args()
    main(args.output)
