"""Host Python 3.6+: isolated build retaining the supplied SDK."""
import argparse
import copy
import datetime
import hashlib
import json
import math
import os
import shutil
import socket
import stat
import subprocess
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

ACCEPTED_RUNTIME_SHA256 = '752e7c6c52b0c6e50a2c7ab37b7705ad21ec43ec18df968866832d07ba09afe9'
RELEASE_ARTIFACTS = {'runtime.json', 'manifest.json', 'validation.json'}


def verify_bundle(bundle):
    """Reject unmanifested runtime files before they can enter the image."""
    manifest = json.loads((bundle / 'SHA256.json').read_text())
    if not isinstance(manifest, dict) or not manifest:
        raise ValueError('Invalid package manifest')
    for rel, digest in manifest.items():
        path = PurePosixPath(rel)
        if (not rel or path.is_absolute() or '..' in path.parts or '\\' in rel
                or ':' in rel or str(path) != rel):
            raise ValueError('Unsafe package manifest path')
        source = bundle / rel
        if source.resolve() != bundle.resolve().joinpath(*path.parts):
            raise ValueError('Package symlinks are not allowed')
        if hashlib.sha256(source.read_bytes()).hexdigest() != digest:
            raise ValueError('Package checksum mismatch: ' + rel)
    actual = {p.relative_to(bundle).as_posix() for p in (bundle / 'grp6_app').rglob('*')
              if p.is_file() or p.is_symlink()}
    expected = {rel for rel in manifest if rel.startswith('grp6_app/')}
    if actual != expected:
        raise ValueError('Unmanifested or missing runtime files')
    artifacts = {rel[len('grp6_app/artifacts/'):] for rel in actual
                 if rel.startswith('grp6_app/artifacts/')}
    if artifacts != RELEASE_ARTIFACTS:
        raise ValueError('Transport release excludes candidate and unknown artifacts')
    runtime_sha = hashlib.sha256((bundle / 'grp6_app/artifacts/runtime.json').read_bytes()).hexdigest()
    if runtime_sha != ACCEPTED_RUNTIME_SHA256:
        raise ValueError('Transport release requires the recorded deployed runtime artifact')
    return runtime_sha


def _persistent_path(value):
    path = PurePosixPath(value)
    if (not path.is_absolute() or str(path) != value or '..' in path.parts
            or '\\' in value or any(ord(c) < 32 for c in value)
            or path == PurePosixPath('/')
            or path.parts[1] in {'tmp', 'run', 'dev', 'proc', 'sys'}
            or path == PurePosixPath('/var/tmp') or PurePosixPath('/var/tmp') in path.parents):
        raise ValueError('Outbox requires a canonical absolute persistent container path')
    return path


def validate_export_config(config, outbox_root):
    """Validate runtime-only inputs without including their values in errors."""
    required = {'GRP6_EXPORT_URL', 'GRP6_EXPORT_TOKEN', 'GRP6_EXPORT_OUTBOX', 'GRP6_EDGE_ID'}
    optional = {'GRP6_EXPORT_QUEUE', 'GRP6_EXPORT_BATCH', 'GRP6_EXPORT_TIMEOUT'}
    if (not isinstance(config, dict) or not required <= set(config)
            or set(config) - required - optional
            or any(not isinstance(v, str) or not v or any(ord(c) < 32 for c in v)
                   for v in config.values())):
        raise ValueError('Export config requires known nonempty string environment values')
    try:
        url = urlsplit(config['GRP6_EXPORT_URL'])
        valid_url = (url.scheme == 'https' and url.hostname and url.port != 0
                     and not url.username and not url.password and not url.query and not url.fragment
                     and url.path == '/api/v1/events/batch'
                     and not any(c.isspace() for c in config['GRP6_EXPORT_URL']))
    except ValueError:
        valid_url = False
    if not valid_url:
        raise ValueError('Export URL requires HTTPS /api/v1/events/batch without URL credentials or query')
    token = config['GRP6_EXPORT_TOKEN']
    if any(not 33 <= ord(c) <= 126 for c in token):
        raise ValueError('Export token must be an ASCII bearer token without whitespace')
    if not 1 <= len(config['GRP6_EDGE_ID']) <= 120 or not config['GRP6_EDGE_ID'].strip():
        raise ValueError('Export edge ID must contain 1..120 characters')
    root = _persistent_path(outbox_root)
    outbox = _persistent_path(config['GRP6_EXPORT_OUTBOX'])
    if root not in outbox.parents:
        raise ValueError('Outbox file must be below the operator-verified persistent root')
    try:
        queue = int(config.get('GRP6_EXPORT_QUEUE', '32'))
        batch = int(config.get('GRP6_EXPORT_BATCH', '1'))
        timeout = float(config.get('GRP6_EXPORT_TIMEOUT', '5'))
    except ValueError:
        raise ValueError('Invalid exporter queue, batch or timeout') from None
    if queue < 1 or not 1 <= batch <= 100 or not math.isfinite(timeout) or timeout <= 0:
        raise ValueError('Invalid exporter queue, batch or timeout')
    return dict(config)


def prepare_descriptor(descriptor, image, config):
    """Preserve the supplied schema and mount fields; never guess a mount API."""
    result = copy.deepcopy(descriptor)
    try:
        matches = [c for c in result['edge']['containers'] if c.get('name') == 'py-app']
        if len(matches) != 1:
            raise ValueError()
        container = matches[0]
        environment = container.setdefault('environment', {})
        if not isinstance(environment, dict):
            raise ValueError()
    except (KeyError, TypeError, AttributeError, ValueError):
        raise ValueError('Descriptor requires exactly one edge py-app container and an environment map') from None
    container['image'] = image
    # Omitted optional values revert to runtime defaults instead of stale settings.
    for key in list(environment):
        if key.startswith('GRP6_EXPORT_') or key == 'GRP6_EDGE_ID':
            del environment[key]
    environment.update(config)
    return result


def _outside(path, roots):
    resolved = path.resolve()
    if any(resolved == root.resolve() or root.resolve() in resolved.parents for root in roots):
        raise ValueError('Private configuration/descriptor must stay outside bundle and build inputs')


def read_private_json(path):
    if (not path.is_file() or path.is_symlink()
            or (os.name == 'posix' and stat.S_IMODE(path.stat().st_mode) & 0o077)):
        raise ValueError('Private configuration must be a regular owner-only file (chmod 600)')
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (ValueError, UnicodeError):
        raise ValueError('Invalid private JSON configuration') from None


def write_private_json(path, value):
    # O_EXCL also refuses symlinks and protects the original descriptor on reruns.
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as handle:
        json.dump(value, handle, indent=2)
        handle.write('\n')

def main(argv=None):
    p=argparse.ArgumentParser()
    p.add_argument('--case',default='/home/user/Case_Event')
    p.add_argument('--build',action='store_true')
    p.add_argument('--push',action='store_true')
    p.add_argument('--descriptor', help='Current descriptor JSON; read only')
    p.add_argument('--export-config', help='Private JSON environment map outside the release/SDK; never baked into image')
    p.add_argument('--descriptor-output', help='Fresh private descriptor path outside release/build inputs; never applied automatically')
    p.add_argument('--outbox-root', help='Operator-verified writable persistent mount path INSIDE the Edge container; no mount is created')
    a=p.parse_args(argv)
    transport_args = (a.descriptor, a.export_config, a.descriptor_output, a.outbox_root)
    if any(transport_args) and not all(transport_args):
        p.error('Descriptor preparation requires --descriptor, --export-config, --descriptor-output and --outbox-root')
    if socket.gethostname().split('.')[0]!='group-6':
        raise SystemExit('Refusing: installer requires verified group-6 host')
    bundle=Path(__file__).resolve().parent
    case=Path(a.case).resolve(); sdk=case/'Edge/oneAPI_py3.10'
    for file in ['bin/liboneAPI.so','bin/libACSAction.so','bin/oneapi.py','py-app.dockerfile']:
        if not (sdk/file).is_file():raise SystemExit('Missing SDK file: '+str(sdk/file))
    runtime_sha = verify_bundle(bundle)
    version=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    staging=case/('grp6_build_'+version)
    image='unifiedserver.local/grp6/py-app:'+version
    descriptor = None
    if a.descriptor:
        config_path, output_path = Path(a.export_config), Path(a.descriptor_output)
        for path in (config_path, output_path, Path(a.descriptor)):
            _outside(path, (bundle, sdk, staging))
        if output_path.exists() or output_path.is_symlink():
            raise ValueError('Descriptor output already exists; choose a fresh path')
        config = validate_export_config(read_private_json(config_path), a.outbox_root)
        descriptor = prepare_descriptor(json.loads(Path(a.descriptor).read_text()),
                                        image.split('/', 1)[1], config)
    staging.mkdir()
    # Do not copy a previously installed application/candidate from the SDK tree.
    def sdk_ignore(directory, names):
        return ['grp6_app'] if Path(directory) == sdk/'bin' else []
    shutil.copytree(str(sdk/'bin'),str(staging/'bin'),ignore=sdk_ignore)
    shutil.copytree(str(bundle/'grp6_app'),str(staging/'bin/grp6_app'))
    shutil.copy2(str(sdk/'py-app.dockerfile'),str(staging/'py-app.dockerfile'))
    (staging/'bin/main.py').write_text('from grp6_app.live_main import main\nif __name__ == "__main__":\n    main()\n')
    record={'team':'grp6','staging':str(staging),'image':image,'runtime_sha256':runtime_sha,
            'sparse_burst_enabled':False, 'exporter_sha256':hashlib.sha256((bundle/'grp6_app/exporter.py').read_bytes()).hexdigest(),
            'built':False, 'pushed':False, 'descriptor_prepared':False, 'deployed':False}
    def run(args):
        print(' '.join(args),flush=True); subprocess.check_call(args,cwd=str(staging))
    if a.build or a.push:
        docker=['sudo','-n','docker']
        run(docker+['build','-f','py-app.dockerfile','-t',image,'.'])
        isolated = docker+['run','--rm','--env','GRP6_EXPORT_URL=','--env','GRP6_EXPORT_TOKEN=','--entrypoint','python3',image]
        run(isolated+['-m','unittest','discover','-s','grp6_app/tests','-v'])
        smoke = ('import hashlib; from pathlib import Path; from grp6_app.runtime import RuntimeModels; '
                 'p=Path("grp6_app/artifacts/runtime.json"); '
                 'assert hashlib.sha256(p.read_bytes()).hexdigest()=="'+ACCEPTED_RUNTIME_SHA256+'"; '
                 'assert not p.with_name("sparse_burst.json").exists(); '
                 'assert RuntimeModels(p).sparse_burst is None; '
                 'from grp6_app.monitor import create_monitor; '
                 'm=create_monitor(p,"/tmp/smoke.jsonl"); '
                 'print("SDK Monitor constructed; accepted model; supplement disabled", type(m).__name__); m.core.close()')
        run(isolated+['-c',smoke])
        record['image_id']=subprocess.check_output(docker+['inspect','--format={{.Id}}',image]).decode().strip()
        record['built']=True
        if a.push:
            run(docker+['push',image])
            record['pushed']=True
    if descriptor is not None:
        write_private_json(output_path, descriptor)
        record['descriptor_prepared']=True
    (staging/'deployment.json').write_text(json.dumps(record,indent=2))
    (case/'grp6_deployment_latest.json').write_text(json.dumps(record,indent=2))
    print(json.dumps(record,indent=2),flush=True)

if __name__=='__main__':
    try:
        main()
    except ValueError as exc:
        raise SystemExit(str(exc))
