"""Local release preparation tests. No Docker, SDK connection or remote access."""
import ast
import contextlib
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from deploy import install_grp6 as installer
from deploy import package_grp6 as packager


def config():
    return {
        'GRP6_EXPORT_URL': 'https://example.invalid/api/v1/events/batch',
        'GRP6_EXPORT_TOKEN': 'test-only-never-a-real-credential',
        'GRP6_EXPORT_OUTBOX': '/var/lib/grp6-export/outbox.sqlite3',
        'GRP6_EDGE_ID': 'grp6-edge-test',
    }


class DescriptorTests(unittest.TestCase):
    def test_config_validates_required_fields_and_defaults(self):
        self.assertEqual(installer.validate_export_config(config(), '/var/lib/grp6-export'), config())
        full = dict(config(), GRP6_EXPORT_QUEUE='32', GRP6_EXPORT_BATCH='100', GRP6_EXPORT_TIMEOUT='5')
        self.assertEqual(installer.validate_export_config(full, '/var/lib/grp6-export'), full)

    def test_bad_config_errors_do_not_echo_values(self):
        changes = [
            ('GRP6_EXPORT_URL', 'http://example.invalid/api/v1/events/batch'),
            ('GRP6_EXPORT_URL', 'https://user:secret@example.invalid/api/v1/events/batch'),
            ('GRP6_EXPORT_URL', 'https://example.invalid/api/v1/events/batch?token=secret'),
            ('GRP6_EXPORT_URL', 'https://example.invalid/api/v1/events/batch#secret'),
            ('GRP6_EXPORT_URL', 'https://example.invalid:bad/api/v1/events/batch'),
            ('GRP6_EXPORT_URL', 'https://example.invalid/other'),
            ('GRP6_EXPORT_TOKEN', 'secret\r\nInjected: yes'),
            ('GRP6_EXPORT_TOKEN', 'secret with spaces'),
            ('GRP6_EXPORT_TOKEN', 'secret-密碼'),
            ('GRP6_EXPORT_TOKEN', ''),
            ('GRP6_EDGE_ID', 'x' * 121),
            ('GRP6_EXPORT_QUEUE', '0'),
            ('GRP6_EXPORT_BATCH', '101'),
            ('GRP6_EXPORT_TIMEOUT', 'nan'),
            ('GRP6_EXPORT_TIMEOUT', 'inf'),
            ('GRP6_EXPORT_TIMEOUT', '-1'),
            ('GRP6_EXPORT_TIMEOUT', 'secret-invalid-number'),
            ('GRP6_EXPORT_OUTBOX', '/tmp/outbox.sqlite3'),
            ('GRP6_EXPORT_OUTBOX', '/var/tmp/outbox.sqlite3'),
            ('GRP6_EXPORT_OUTBOX', '/var/lib/grp6-export/../escape.sqlite3'),
            ('GRP6_EXPORT_OUTBOX', '/var/lib/grp6-export2/outbox.sqlite3'),
            ('GRP6_EXPORT_OUTBOX', '/var/lib/grp6-export'),
            ('GRP6_EXPORT_OUTBOX', 'relative.sqlite3'),
            ('UNKNOWN_SECRET', 'secret'),
        ]
        for key, value in changes:
            with self.subTest(key=key, value=value):
                invalid = dict(config(), **{key: value})
                with self.assertRaises(ValueError) as error:
                    installer.validate_export_config(invalid, '/var/lib/grp6-export')
                self.assertNotIn('secret', str(error.exception).lower())
        for key in config():
            missing = config()
            del missing[key]
            with self.assertRaises(ValueError):
                installer.validate_export_config(missing, '/var/lib/grp6-export')

    def test_descriptor_preserves_other_containers_and_supplied_fields(self):
        source = json.loads((packager.ROOT / 'Case_Event/SmarTest/app_descriptor.json').read_text())
        target = source['edge']['containers'][0]
        target['platform_specific_storage'] = {'opaque': 'preserve-verbatim'}
        target['environment']['GRP6_EXPORT_BATCH'] = '99'
        source['edge']['containers'].append({'name': 'other', 'image': 'unchanged'})
        original = copy.deepcopy(source)
        result = installer.prepare_descriptor(source, 'grp6/py-app:test-pinned', config())
        self.assertEqual(source, original)
        prepared = result['edge']['containers'][0]
        self.assertEqual(prepared['image'], 'grp6/py-app:test-pinned')
        self.assertEqual(prepared['platform_specific_storage'], target['platform_specific_storage'])
        self.assertEqual(prepared['environment']['ONEAPI_DEBUG'], '6')
        self.assertNotIn('GRP6_EXPORT_BATCH', prepared['environment'])
        self.assertEqual(result['edge']['containers'][1], source['edge']['containers'][1])

    def test_descriptor_refuses_missing_ambiguous_or_invalid_target(self):
        for containers in ([], [{'name': 'other'}], [{'name': 'py-app'}] * 2,
                           [{'name': 'py-app', 'environment': []}]):
            with self.assertRaises(ValueError):
                installer.prepare_descriptor({'edge': {'containers': containers}}, 'grp6/py-app:pin', config())

    def test_private_output_is_exclusive_and_confined_outside_inputs(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target = root / 'private.json'
            installer.write_private_json(target, config())
            self.assertEqual(installer.read_private_json(target), config())
            with self.assertRaises(FileExistsError):
                installer.write_private_json(target, {'overwrite': True})
            self.assertEqual(json.loads(target.read_text()), config())
            with self.assertRaises(ValueError):
                installer._outside(target, [root])
            installer._outside(target, [root / 'bundle'])
            if os.name == 'posix':
                self.assertEqual(target.stat().st_mode & 0o777, 0o600)
                target.chmod(0o644)
                with self.assertRaises(ValueError):
                    installer.read_private_json(target)


class ReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.root = Path(cls.folder.name)
        cls.archive = cls.root / 'transport.zip'
        with contextlib.redirect_stdout(io.StringIO()):
            packager.main(cls.archive)

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def unpack(self, root):
        bundle = root / 'release'
        with zipfile.ZipFile(self.archive) as archive:
            archive.extractall(bundle)
        return bundle

    def test_release_contains_hardened_exporter_and_only_accepted_artifacts(self):
        with zipfile.ZipFile(self.archive) as archive:
            artifacts = {n.rsplit('/', 1)[1] for n in archive.namelist() if n.startswith('grp6_app/artifacts/')}
            self.assertEqual(artifacts, installer.RELEASE_ARTIFACTS)
            self.assertNotIn('grp6_app/artifacts/sparse_burst.json', archive.namelist())
            self.assertIn('grp6_app/sparse_burst.py', archive.namelist())
            self.assertEqual(archive.read('grp6_app/exporter.py'), (packager.ROOT / 'grp6_app/exporter.py').read_bytes())
            for rel, digest in json.loads(archive.read('SHA256.json')).items():
                self.assertEqual(hashlib.sha256(archive.read(rel)).hexdigest(), digest)
        with tempfile.TemporaryDirectory() as folder:
            bundle = self.unpack(Path(folder))
            self.assertEqual(installer.verify_bundle(bundle), packager.ACCEPTED_RUNTIME_SHA256)
            result = subprocess.run([sys.executable, '-B', '-c',
                'from grp6_app.runtime import RuntimeModels; '
                'm=RuntimeModels("grp6_app/artifacts/runtime.json"); '
                'assert m.sparse_burst is None; '
                'assert m.detector().sparse_burst.analyze(True)==[]; print(m.sparse_burst_status)'],
                cwd=str(bundle), capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('missing', result.stdout)

    def test_existing_archive_cannot_be_overwritten(self):
        before = self.archive.read_bytes()
        with self.assertRaises(FileExistsError):
            packager.main(self.archive)
        self.assertEqual(self.archive.read_bytes(), before)

    def test_packager_refuses_changed_model(self):
        runtime = packager.ROOT / 'grp6_app/artifacts/runtime.json'
        read_bytes = Path.read_bytes
        def changed(path):
            return b'{}' if path == runtime else read_bytes(path)
        with patch.object(Path, 'read_bytes', changed):
            with self.assertRaisesRegex(ValueError, 'recorded deployed runtime'):
                packager.main(self.root / 'not-created.zip')
        self.assertFalse((self.root / 'not-created.zip').exists())

    def test_installer_refuses_extra_files_candidate_even_if_manifested_and_model_change(self):
        for rel, manifest_it in [('grp6_app/artifacts/sparse_burst.json', False),
                                 ('grp6_app/artifacts/sparse_burst.json', True),
                                 ('grp6_app/private.env', False),
                                 ('grp6_app/artifacts/runtime.json', True)]:
            with self.subTest(rel=rel, manifested=manifest_it), tempfile.TemporaryDirectory() as folder:
                bundle = self.unpack(Path(folder))
                (bundle / rel).write_bytes(b'{}')
                if manifest_it:
                    manifest = json.loads((bundle / 'SHA256.json').read_text())
                    manifest[rel] = hashlib.sha256(b'{}').hexdigest()
                    (bundle / 'SHA256.json').write_text(json.dumps(manifest))
                with self.assertRaises(ValueError):
                    installer.verify_bundle(bundle)

    def test_manifest_traversal_and_checksum_mismatch_are_rejected(self):
        for rel in ('../outside', '/absolute', 'C:/absolute', 'grp6_app\\escape'):
            with self.subTest(rel=rel), tempfile.TemporaryDirectory() as folder:
                bundle = self.unpack(Path(folder))
                (bundle / 'SHA256.json').write_text(json.dumps({rel: '0' * 64}))
                with self.assertRaisesRegex(ValueError, 'Unsafe package'):
                    installer.verify_bundle(bundle)
        with tempfile.TemporaryDirectory() as folder:
            bundle = self.unpack(Path(folder))
            (bundle / 'grp6_app/exporter.py').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                installer.verify_bundle(bundle)

    def test_installer_python36_syntax(self):
        ast.parse(Path(installer.__file__).read_text(), feature_version=(3, 6))

    def test_install_flow_keeps_secrets_out_of_image_and_logs_and_never_applies_descriptor(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            bundle = self.unpack(root)
            case = root / 'case'
            sdk = case / 'Edge/oneAPI_py3.10'
            (sdk / 'bin/grp6_app/artifacts').mkdir(parents=True)
            (sdk / 'bin/grp6_app/artifacts/sparse_burst.json').write_text('stale candidate')
            for name in ('bin/liboneAPI.so', 'bin/libACSAction.so', 'bin/oneapi.py', 'py-app.dockerfile'):
                (sdk / name).write_text('sdk fixture')
            source = root / 'descriptor.json'
            source.write_text(json.dumps({'edge': {'containers': [{'name': 'py-app', 'image': 'old'}]}}))
            original = source.read_bytes()
            secret = root / 'secret.json'
            installer.write_private_json(secret, config())
            output = root / 'prepared.json'
            stdout = io.StringIO()
            with patch.object(installer, '__file__', str(bundle / 'install_grp6.py')), \
                    patch.object(installer.socket, 'gethostname', return_value='group-6'), \
                    patch.object(installer.subprocess, 'check_call') as calls, \
                    patch.object(installer.subprocess, 'check_output', return_value=b'sha256:test\n'), \
                    contextlib.redirect_stdout(stdout):
                installer.main(['--case', str(case), '--build', '--push', '--descriptor', str(source),
                                '--export-config', str(secret), '--descriptor-output', str(output),
                                '--outbox-root', '/var/lib/grp6-export'])
            record = json.loads((case / 'grp6_deployment_latest.json').read_text())
            self.assertTrue(record['built'] and record['pushed'] and record['descriptor_prepared'])
            self.assertFalse(record['deployed'] or record['sparse_burst_enabled'])
            self.assertEqual(source.read_bytes(), original)
            prepared = json.loads(output.read_text())['edge']['containers'][0]
            self.assertEqual(prepared['image'], record['image'].split('/', 1)[1])
            self.assertEqual(prepared['environment'], config())
            self.assertNotIn(config()['GRP6_EXPORT_TOKEN'], stdout.getvalue())
            staging = Path(record['staging'])
            self.assertFalse((staging / 'bin/grp6_app/artifacts/sparse_burst.json').exists())
            for path in staging.rglob('*'):
                if path.is_file():
                    self.assertNotIn(config()['GRP6_EXPORT_TOKEN'].encode(), path.read_bytes())
            commands = [call.args[0] for call in calls.call_args_list]
            self.assertEqual(len(commands), 4)  # build, unit tests, smoke, versioned push
            self.assertEqual(commands[-1], ['sudo', '-n', 'docker', 'push', record['image']])
            self.assertNotIn(':latest', str(commands))
            self.assertIn('GRP6_EXPORT_URL=', commands[1])


if __name__ == '__main__':
    unittest.main()
