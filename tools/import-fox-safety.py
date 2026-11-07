"""Extract reviewed data from the supplied fox project without running its code."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
args = parser.parse_args()
source = args.source.resolve()
root = Path(__file__).resolve().parent.parent
database = source / 'upstream/database.db'
apk = source / 'fox-safety-1.0.0.apk'
with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as db:
    rows = db.execute('SELECT t.question,t.answer,d.title,d.options FROM tiku t JOIN tiku_detail d ON t.question=d.question ORDER BY t.question').fetchall()

questions = []
for ident, answer, title, raw_options in rows:
    original = sorted(json.loads(raw_options), key=lambda item: int(item.get('sequence', 0)))
    options = [{'key': chr(65 + index), 'text': str(item['content']), 'platformId': str(item['id'])} for index, item in enumerate(original)]
    answer_ids = [value.strip() for value in str(answer).split(',') if value.strip()]
    labels = {option['platformId']: option['key'] for option in options}
    resolved = bool(answer_ids) and all(value in labels for value in answer_ids)
    questions.append({'id': str(ident), 'title': str(title), 'options': [{'key': item['key'], 'text': item['text']} for item in options],
                      'answer': '、'.join(labels[value] for value in answer_ids) if resolved else str(answer),
                      'answerKind': 'letters' if resolved else 'option_ids', 'source': 'github'})

output = root / 'src/plugins/data'
output.mkdir(parents=True, exist_ok=True)
payload = {'schemaVersion': 1, 'source': {'name': 'Scwizard/jiangsu-safety-competition',
    'commit': '4b797158c1886d5c457eaf33a4afd1a4a0218fbd', 'license': 'Apache-2.0',
    'databaseSha256': hashlib.sha256(database.read_bytes()).hexdigest()}, 'questions': questions}
(output / 'fox-safety-bank.json').write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
license_dir = root / 'public/plugin-licenses'
license_dir.mkdir(parents=True, exist_ok=True)
shutil.copyfile(source / 'upstream/LICENSE', license_dir / 'fox-safety-Apache-2.0.txt')

# The unlicensed, user-supplied script stays outside the distributable source tree.
# Only plain data is extracted from the APK; no JS / Python / APK code is executed.
with zipfile.ZipFile(apk) as archive:
    original = json.loads(archive.read('assets/library.json'))
extra = [{'title': item['title'], 'answer': item['answer']} for item in original if item['source'] == '页面脚本']
private_output = source / 'ohu-plugin'
private_output.mkdir(exist_ok=True)
(private_output / 'fox-safety-extra-bank.json').write_text(json.dumps({'schemaVersion': 1, 'questions': extra}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(json.dumps({'bundledQuestions': len(questions), 'unresolvedAnswers': sum(item['answerKind'] == 'option_ids' for item in questions),
    'optionalImportQuestions': len(extra), 'apkSha256': hashlib.sha256(apk.read_bytes()).hexdigest()}, ensure_ascii=True))
