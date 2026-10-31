"""Compare signed APK web assets with the final Capacitor build; never modifies the APK."""
from pathlib import Path
from hashlib import sha256
import json
import re
import shutil
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[2]
apk = Path(sys.argv[1]).resolve()
dist = root / 'dist-app'
with zipfile.ZipFile(apk) as package:
    files = [path for path in dist.rglob('*') if path.is_file()]
    expected = {'assets/public/' + path.relative_to(dist).as_posix() for path in files}
    actual = {name for name in package.namelist() if name.startswith('assets/public/') and not name.endswith('/')}
    generated = {'assets/public/cordova.js', 'assets/public/cordova_plugins.js', 'assets/public/capacitor.js'}
    assert not actual - expected - generated, f'Stale APK web assets: {sorted(actual - expected - generated)}'
    for path in files:
        member = 'assets/public/' + path.relative_to(dist).as_posix()
        assert package.read(member) == path.read_bytes(), f'APK asset differs: {member}'
    packs = sorted(path.name for path in (dist / 'theme-packs').glob('*.ohfox'))
    assert packs == ['ohfox-cute-v3.ohfox', 'ohfox-minimal-v4.ohfox', 'ohfox-theme-v1.ohfox']
    previews = [name for name in package.namelist() if name.startswith('assets/public/launcher-icon-previews/') and name.endswith('.png')]
    assert len(previews) == 13
    assert not any(name.endswith('.glb') for name in package.namelist()), 'Unexpected live 3D model payload'
sdk_tools = Path('C:/Users/upwar/AppData/Local/Android/Sdk/build-tools/34.0.0')
# aapt's Windows ZIP reader cannot open Unicode paths; inspect the identical ASCII build output.
native_apk = Path('C:/Users/upwar/.codex/ui-builds/ohfox-ui-v3-v4/android/app/build/outputs/apk/user/release/app-user-release.apk')
assert sha256(native_apk.read_bytes()).digest() == sha256(apk.read_bytes()).digest()
def run(*args):
    result = subprocess.run(args, capture_output=True, encoding='utf-8', errors='replace')
    assert result.returncode == 0, result.stderr
    return result.stdout
badging = run(str(sdk_tools / 'aapt.exe'), 'dump', 'badging', str(native_apk))
assert "name='com.sunshinecampus.app' versionCode='59' versionName='1.2.38'" in badging
assert "sdkVersion:'23'" in badging and "targetSdkVersion:'35'" in badging
assert "native-code: 'arm64-v8a'" in badging
manifest = run(str(sdk_tools / 'aapt.exe'), 'dump', 'xmltree', str(native_apk), 'AndroidManifest.xml')
aliases = sorted(set(re.findall(r'"(com\.sunshinecampus\.app\.Launcher(?:Default|Streak\d+|Away\d+))"', manifest)))
assert len(aliases) == 13, aliases
signing = run(shutil.which('java'), '-jar', str(sdk_tools / 'lib/apksigner.jar'), 'verify', '--verbose', '--print-certs', str(native_apk))
assert 'Verifies' in signing and 'Verified using v2 scheme (APK Signature Scheme v2): true' in signing
certificate = re.search(r'Signer #1 certificate SHA-256 digest: (\w+)', signing).group(1)
assert certificate == '88b2c5dd74746c81b16031955880da26e04b516b45a8b5104d0c662c95e5fd12', 'Upgrade signing certificate differs from the previous release'
unit_result = ET.parse('C:/Users/upwar/.codex/ui-builds/ohfox-ui-v3-v4/android/app/build/test-results/testUserDebugUnitTest/TEST-com.sunshinecampus.app.LauncherMoodTest.xml').getroot().attrib
assert unit_result['tests'] == '2' and unit_result['failures'] == '0' and unit_result['errors'] == '0'
report = {
    'apk': str(apk), 'bytes': apk.stat().st_size, 'sha256': sha256(apk.read_bytes()).hexdigest(),
    'web_asset_files_compared': len(files), 'theme_packs': packs, 'launcher_previews': len(previews),
    'entry_scripts': re.findall(r'src="([^"]+\.js)"', (dist / 'index.html').read_text(encoding='utf-8')),
    'settings_chunks': [path.name for path in (dist / 'assets').glob('SettingsPage-*.js')],
    'stale_web_assets': [], 'launcher_aliases': aliases,
    'package': 'com.sunshinecampus.app', 'version_name': '1.2.38', 'version_code': 59,
    'abi': ['arm64-v8a'], 'min_sdk': 23, 'target_sdk': 35,
    'signature_verified': True, 'same_certificate_as_previous_release': True,
    'signing_certificate_sha256': certificate,
    'gradle_android_unit_tests': {'tests': 2, 'failures': 0, 'errors': 0},
    'device_tested': False,
    'result': 'all packaged web assets match dist-app',
}
if len(sys.argv) > 2:
    Path(sys.argv[2]).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
