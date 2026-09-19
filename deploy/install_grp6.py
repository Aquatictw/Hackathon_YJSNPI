"""Host Python 3.6+: isolated build retaining the supplied SDK."""
import argparse
import datetime
import hashlib
import json
import shutil
import socket
import subprocess
from pathlib import Path

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--case',default='/home/user/Case_Event')
    p.add_argument('--build',action='store_true')
    p.add_argument('--push',action='store_true')
    a=p.parse_args()
    if socket.gethostname().split('.')[0]!='group-6':
        raise SystemExit('Refusing: installer requires verified group-6 host')
    bundle=Path(__file__).resolve().parent
    case=Path(a.case).resolve(); sdk=case/'Edge/oneAPI_py3.10'
    for file in ['bin/liboneAPI.so','bin/libACSAction.so','bin/oneapi.py','py-app.dockerfile']:
        if not (sdk/file).is_file():raise SystemExit('Missing SDK file: '+str(sdk/file))
    for rel,digest in json.loads((bundle/'SHA256.json').read_text()).items():
        if hashlib.sha256((bundle/rel).read_bytes()).hexdigest()!=digest:
            raise SystemExit('Package checksum mismatch: '+rel)
    version=datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')
    staging=case/('grp6_build_'+version); staging.mkdir()
    shutil.copytree(str(sdk/'bin'),str(staging/'bin'))
    shutil.copytree(str(bundle/'grp6_app'),str(staging/'bin/grp6_app'))
    shutil.copy2(str(sdk/'py-app.dockerfile'),str(staging/'py-app.dockerfile'))
    (staging/'bin/main.py').write_text('from grp6_app.live_main import main\nif __name__ == "__main__":\n    main()\n')
    image='unifiedserver.local/grp6/py-app:'+version
    latest='unifiedserver.local/grp6/py-app:latest'
    record={'team':'grp6','staging':str(staging),'image':image,'runtime_sha256':hashlib.sha256((bundle/'grp6_app/artifacts/runtime.json').read_bytes()).hexdigest()}
    def run(args):
        print(' '.join(args),flush=True); subprocess.check_call(args,cwd=str(staging))
    if a.build or a.push:
        docker=['sudo','-n','docker']
        run(docker+['build','-f','py-app.dockerfile','-t',image,'.'])
        run(docker+['run','--rm','--entrypoint','python3',image,'-m','unittest','discover','-s','grp6_app/tests','-v'])
        run(docker+['run','--rm','--entrypoint','python3',image,'-c','from grp6_app.monitor import create_monitor; m=create_monitor("grp6_app/artifacts/runtime.json","/tmp/smoke.jsonl"); print("SDK Monitor constructed", type(m).__name__)'])
        record['image_id']=subprocess.check_output(docker+['inspect','--format={{.Id}}',image]).decode().strip()
        if a.push:
            run(docker+['push',image]); run(docker+['tag',image,latest]); run(docker+['push',latest])
    (staging/'deployment.json').write_text(json.dumps(record,indent=2))
    (case/'grp6_deployment_latest.json').write_text(json.dumps(record,indent=2))
    print(json.dumps(record,indent=2),flush=True)

if __name__=='__main__': main()
