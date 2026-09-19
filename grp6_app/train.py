import argparse,json
from pathlib import Path
from .data import load_training
from .predict import StageModels
def main():
    p = argparse.ArgumentParser()
    p.add_argument("data_dir")
    p.add_argument("--manifest", required=True, help="JSON stage allowlists verified against the test flow")
    p.add_argument("--model", default="models/stages.pkl")
    a = p.parse_args()
    manifest = json.loads(Path(a.manifest).read_text(encoding="utf-8"))
    m = StageModels().fit(load_training(a.data_dir), allowlists=manifest["stages"])
    if set(m.models) != set(range(1, 7)):
        raise ValueError("All six stages require valid features and training targets")
    Path(a.model).parent.mkdir(parents=True, exist_ok=True)
    m.save(a.model)
    Path(a.model + ".json").write_text(json.dumps({"features":m.features,"defaults":m.defaults}, indent=2))
    print({"feature_counts": {k: len(v) for k,v in m.features.items()}, "targets":list(m.models)})
if __name__=="__main__": main()
