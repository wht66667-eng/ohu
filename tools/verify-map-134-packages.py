"""Verify actual release archives before copying them to the delivery directory."""
from pathlib import Path
import hashlib, json, plistlib, zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.map-qa-output'
OUT.mkdir(exist_ok=True)
reports = []
apk_root = ROOT / '.release-out/apk/1.2.134-134'
manifest = json.loads((apk_root / 'release-both.json').read_text(encoding='utf-8'))
assert manifest['version'] == '1.2.134' and manifest['build'] == 134

def verify(path, platform, shell, expected_hash):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    assert digest == expected_hash, f'Hash mismatch: {path}'
    with zipfile.ZipFile(path) as z:
        assert z.testzip() is None, 'Archive CRC failed'
        names = z.namelist()
        prefix = 'assets/public/' if platform == 'android' else 'Payload/App.app/public/'
        marker = json.loads(z.read(prefix + 'release-target.json'))
        assert marker['version'] == '1.2.134' and marker['shell'] == shell
        workers = [n for n in names if n.startswith(prefix) and 'maplibre-gl-worker-' in n and n.endswith('.js')]
        if shell == 'user':
            assert len(workers) == 1, 'Student map worker missing'
            assert len(z.read(workers[0])) > 100000, 'Map worker unexpectedly empty'
        else:
            assert not workers, 'Student map renderer incorrectly included in admin package'
        for n in names:
            if n.startswith(prefix) and n.endswith(('.js', '.html', '.json')):
                content = z.read(n)
                assert b'qa-student-a' not in content and b'qa-admin' not in content, 'Virtual identities shipped'
                assert '虚拟验收·'.encode() not in content, 'Synthetic points shipped'
        if platform == 'ios':
            plist = plistlib.loads(z.read('Payload/App.app/Info.plist'))
            assert plist['CFBundleShortVersionString'] == '1.2.134'
            assert str(plist['CFBundleVersion']) == '134'
            assert plist['CFBundleIdentifier'] == ('com.sunshinecampus.admin' if shell == 'admin' else 'com.sunshinecampus.app')
            assert marker['otaEnabled'] is False
        reports.append({'file': path.name, 'platform': platform, 'shell': shell, 'version': '1.2.134', 'sha256': digest, 'bytes': path.stat().st_size, 'archiveVerified': True, 'testDataAbsent': True, 'mapWorkers': workers, 'signed': platform == 'android', 'physicalDeviceTested': False})

for artifact in manifest['artifacts']:
    verify(apk_root / artifact['file'], 'android', artifact['shell'], artifact['sha256'])
ios_root = ROOT / '.release-out/ios/1.2.134-134'
for shell in ['user', 'admin']:
    receipts = list(ios_root.glob(f'**/Ohhu-iOS-{shell}-*/unsigned-build.json'))
    if not receipts:
        receipts = [p for p in ios_root.glob('**/unsigned-build.json') if json.loads(p.read_text()).get('shell') == shell]
    assert len(receipts) == 1, f'Expected one iOS receipt for {shell}'
    receipt_path = receipts[0]
    receipt = json.loads(receipt_path.read_text())
    assert receipt['nativeCompilationPassed'] and receipt['payloadReadBackIdentityVerified']
    assert receipt['version'] == '1.2.134' and receipt['build'] == 134
    assert receipt['signed'] is False and receipt['installable'] is False
    verify(receipt_path.parent / receipt['ipaFile'], 'ios', shell, receipt['ipaSha256'])

(OUT / 'package-verification.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(reports, ensure_ascii=False, indent=2))
