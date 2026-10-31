#!/usr/bin/env python3
"""把版本号同步到 1.2.106 / 106（五处 + app-update.ts）。

规则（来自 sunshine-apk-release 技能 §1 的血泪教训）：
- 每个文件独立 try/except，一个失败不能中断其余文件（曾因 capacitor.config.ts
  断言抛异常，排在后面的 assets/capacitor.config.json 静默漏改）。
- 只改本次目标版本，改完由外部再 grep 复核，不在这里自证。
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = "1.2.106"
BUILD = 106

results = []


def report(name, ok, detail=""):
    results.append((name, ok, detail))


def rw(rel):
    p = os.path.join(ROOT, rel)
    with io.open(p, "r", encoding="utf-8") as f:
        return p, f.read()


def patch_package_json():
    rel = "package.json"
    p, s = rw(rel)
    new, n = re.subn(r'("version"\s*:\s*)"[^"]*"', r'\g<1>"%s"' % TARGET, s, count=1)
    assert n == 1, "version 字段没匹配到"
    assert '"%s"' % TARGET in new
    with io.open(p, "w", encoding="utf-8") as f:
        f.write(new)
    report(rel, True)


def patch_build_gradle():
    rel = "android/app/build.gradle"
    p, s = rw(rel)
    s2, n1 = re.subn(r"(versionCode\s+)\d+", r"\g<1>%d" % BUILD, s, count=1)
    s3, n2 = re.subn(r'(versionName\s+")[^"]*(")', r'\g<1>%s\g<2>' % TARGET, s2, count=1)
    assert n1 == 1 and n2 == 1, "versionCode/versionName 没匹配到"
    with io.open(p, "w", encoding="utf-8") as f:
        f.write(s3)
    report(rel, True)


def patch_capacitor_ts():
    rel = "capacitor.config.ts"
    p, s = rw(rel)
    # 只改 plugins.CapacitorUpdater.version，别动 appId 等
    i = s.find("CapacitorUpdater")
    assert i > 0, "找不到 CapacitorUpdater 配置块"
    seg = s[i:]
    seg2, n = re.subn(r"(version\s*:\s*)'[^']*'", r"\g<1>'%s'" % TARGET, seg, count=1)
    assert n == 1, "CapacitorUpdater.version 没匹配到"
    new = s[:i] + seg2
    assert "'%s'" % TARGET in new
    with io.open(p, "w", encoding="utf-8") as f:
        f.write(new)
    report(rel, True)


def patch_capacitor_json():
    """原生真正读的那份：cap sync 被沙箱拦着不会重新生成，必须手改。"""
    rel = "android/app/src/main/assets/capacitor.config.json"
    p, s = rw(rel)
    cfg = json.loads(s)
    plug = cfg.setdefault("plugins", {}).setdefault("CapacitorUpdater", {})
    plug["version"] = TARGET
    out = json.dumps(cfg, indent="\t", ensure_ascii=False) + "\n"
    assert '"version": "%s"' % TARGET in out
    with io.open(p, "w", encoding="utf-8") as f:
        f.write(out)
    report(rel, True)


def patch_app_update_ts():
    rel = "src/lib/app-update.ts"
    p, s = rw(rel)
    s2, n1 = re.subn(r"(APP_VERSION\s*=\s*)'[^']*'", r"\g<1>'%s'" % TARGET, s, count=1)
    s3, n2 = re.subn(r"(APP_BUILD\s*=\s*)\d+", r"\g<1>%d" % BUILD, s2, count=1)
    assert n1 == 1 and n2 == 1, "APP_VERSION/APP_BUILD 没匹配到"
    with io.open(p, "w", encoding="utf-8") as f:
        f.write(s3)
    report(rel, True)


def patch_changelog():
    rel = "docs/CHANGELOG.md"
    p, s = rw(rel)
    lines = s.split("\n")
    idx = None
    for i, ln in enumerate(lines):
        if ln.startswith("| **%s** |" % TARGET):
            idx = i
            break
    assert idx is not None, "CHANGELOG 里找不到 %s 行" % TARGET
    ln = lines[idx]
    # 标签列：OTA 双壳 -> APK 两端 + OTA
    ln2 = ln.replace("| OTA 双壳 |", "| APK 两端 + OTA |")
    # 正文里那句「只发 OTA、未重打 APK」已不成立
    ln2 = ln2.replace(
        "**本次只发 OTA，未重打 APK**：壳仍是 1.2.101。",
        "**本次同时重打 APK**：壳由 1.2.101 升到 **%s**（内置上述全部内容，新装无需再下热更包），"
        "OTA 双壳同号已先发。老壳（1.2.101）冷启动仍会升到 %s。" % (TARGET, TARGET),
    )
    assert ln2 != ln, "CHANGELOG 行没有任何替换（断言词可能已变）"
    lines[idx] = ln2
    with io.open(p, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    report(rel, True)


for fn in (
    patch_package_json,
    patch_build_gradle,
    patch_capacitor_ts,
    patch_capacitor_json,
    patch_app_update_ts,
    patch_changelog,
):
    try:
        fn()
    except Exception as e:  # 不中断其余文件
        report(fn.__name__, False, "%s: %s" % (type(e).__name__, e))

print("=== patch 结果 ===")
bad = 0
for name, ok, detail in results:
    print(("  OK   " if ok else "  FAIL ") + name + (("  <- " + detail) if detail else ""))
    if not ok:
        bad += 1
sys.exit(1 if bad else 0)
