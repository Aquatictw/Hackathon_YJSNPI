"""Isolated read-only-source investigation preparation. Run from repository root."""
import hashlib, json, shutil, subprocess, sys
from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdfium
ROOT = Path.cwd()
OUT = ROOT / 'results/replay_investigation_20260919/model'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
inputs = [ROOT/'Question_20260919.pdf', ROOT/'SYSTEM.md', ROOT/'AGENTS.md']
inputs += list((ROOT/'grp6_app').glob('*.py'))
inputs += list((ROOT/'grp6_app/artifacts').glob('*'))
inputs += list((ROOT/'results/replay').rglob('*'))
inputs += list((ROOT/'source_review/training/Data').glob('*.csv'))
inputs += list((ROOT/'source_review/SmarTest/Case_Smt870/src/TestCase1').glob('*.flow'))
record = {'head':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
          'python':sys.executable,'python_version':sys.version,
          'initial_git_status':subprocess.check_output(['git','status','--short'],text=True),
          'sha256':{p.relative_to(ROOT).as_posix():sha(p) for p in inputs if p.is_file()}}
(OUT/'inputs.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
for variant in ['baseline','candidate']:
    dest=OUT/(variant+'_artifacts'); dest.mkdir(exist_ok=False)
    for name in ['runtime.json','manifest.json','validation.json']:
        shutil.copyfile(ROOT/'grp6_app/artifacts'/name,dest/name)
    if variant=='candidate': shutil.copyfile(ROOT/'grp6_app/artifacts/sparse_burst.json',dest/'sparse_burst.json')
reader=PdfReader(ROOT/'Question_20260919.pdf')
(OUT/'question_extracted.txt').write_text(chr(10).join(f'--- PAGE {i+1} ---'+chr(10)+p.extract_text() for i,p in enumerate(reader.pages)),encoding='utf-8')
pdf=pdfium.PdfDocument(str(ROOT/'Question_20260919.pdf'))
for page in [2,3]: pdf[page].render(scale=2).to_pil().save(OUT/f'question_page_{page+1}.png')
print(json.dumps({'head':record['head'],'files_hashed':len(record['sha256']),'output':str(OUT)}))
