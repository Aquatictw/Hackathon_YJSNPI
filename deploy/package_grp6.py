"""Create a selective, verified stdlib runtime bundle."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def main():
    files = {}
    for name in ["__init__.py", "state.py", "runtime.py", "monitor.py", "live_main.py",
                 "report.py", "data.py", "metadata.py", "rehearse.py"]:
        files["grp6_app/" + name] = (ROOT / "grp6_app" / name).read_bytes()
    for name in ["test_state.py", "test_monitor.py", "test_report.py"]:
        files["grp6_app/tests/" + name] = (ROOT / "grp6_app/tests" / name).read_bytes()
    for path in sorted((ROOT / "grp6_app/artifacts").glob("*.json")):
        files["grp6_app/artifacts/" + path.name] = path.read_bytes()
    files["README.md"] = (ROOT / "README.md").read_bytes()
    for name in ["install_grp6.py", "audit_evidence.py"]:
        files[name] = (ROOT / "deploy" / name).read_bytes()
    for name in ["summary.json", "report.html", "replay.jsonl"]:
        files["results/replay/" + name] = (ROOT / "results/replay" / name).read_bytes()
    digests = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    files["SHA256.json"] = json.dumps(digests, indent=2).encode()
    target = ROOT / "grp6_deploy.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None
        for name, digest in digests.items():
            assert hashlib.sha256(archive.read(name)).hexdigest() == digest
    print(str(target), target.stat().st_size, hashlib.sha256(target.read_bytes()).hexdigest())

if __name__ == "__main__":
    main()
