#!/usr/bin/env python3
"""把版本号同步到指定版本（五处）。

用法：
    python tools/patch-version.py 1.2.112 112

五处（来自 sunshine-apk-release 技能 §1 的血泪教训）：
  1. package.json                -> "version"
  2. android/app/build.gradle    -> versionCode / versionName
  3. capacitor.config.ts         -> plugins.CapacitorUpdater.version
  4. android/app/src/main/assets/capacitor.config.json  （原生真正读的那份）
  5. src/lib/app-version.ts      -> WEB_VERSION / WEB_BUILD

规则：
- 每个文件独立 try/except，一个失败不能中断其余文件（曾因 capacitor.config.ts
  断言抛异常，排在后面的 assets/capacitor.config.json 静默漏改）。
- 只改目标版本，改完由外部再 grep 复核，脚本不自证。
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

results = []


def report(name, ok, detail=""):
    results.append((name, ok, detail))


def rw(rel):
    p = os.path.join(ROOT, rel)
    with io.open(p, "r", encoding="utf-8") as f:
        return p, f.read()


def write(p, s):
    with io.open(p, "w", encoding="utf-8") as f:
        f.write(s)


def patch_package_json(target):
    rel = "package.json"
    p, s = rw(rel)
    new, n = re.subn(r'("version"\s*:\s*)"[^"]*"', r'\g<1>"%s"' % target, s, count=1)
    assert n == 1, "version 字段没匹配到"
    assert '"%s"' % target in new
    write(p, new)
    lock_path = os.path.join(ROOT, 'package-lock.json')
    if os.path.exists(lock_path):
        with io.open(lock_path, 'r', encoding='utf-8') as f:
            lock = json.load(f)
        lock['version'] = target
        if '' in lock.get('packages', {}):
            lock['packages']['']['version'] = target
        write(lock_path, json.dumps(lock, ensure_ascii=False, indent=2) + '\n')
    report(rel, True)


def patch_build_gradle(target, build):
    rel = "android/app/build.gradle"
    p, s = rw(rel)
    s2, n1 = re.subn(r"(versionCode\s+)\d+", r"\g<1>%d" % build, s, count=1)
    s3, n2 = re.subn(r'(versionName\s+")[^"]*(")', r'\g<1>%s\g<2>' % target, s2, count=1)
    assert n1 == 1 and n2 == 1, "versionCode/versionName 没匹配到"
    write(p, s3)
    report(rel, True)


def patch_capacitor_ts(target):
    rel = "capacitor.config.ts"
    p, s = rw(rel)
    # 只改 plugins.CapacitorUpdater.version，别动 appId / server 等
    i = s.find("CapacitorUpdater")
    assert i > 0, "找不到 CapacitorUpdater 配置块"
    seg = s[i:]
    seg2, n = re.subn(r"(version\s*:\s*)'[^']*'", r"\g<1>'%s'" % target, seg, count=1)
    assert n == 1, "CapacitorUpdater.version 没匹配到"
    new = s[:i] + seg2
    assert "'%s'" % target in new
    write(p, new)
    report(rel, True)


def patch_capacitor_json(target):
    """原生真正读的那份：cap sync 被沙箱拦着不会重新生成，必须手改。"""
    rel = "android/app/src/main/assets/capacitor.config.json"
    p, s = rw(rel)
    cfg = json.loads(s)
    plug = cfg.setdefault("plugins", {}).setdefault("CapacitorUpdater", {})
    plug["version"] = target
    out = json.dumps(cfg, indent="\t", ensure_ascii=False) + "\n"
    assert '"version": "%s"' % target in out
    write(p, out)
    report(rel, True)


def patch_app_update_ts(target, build):
    rel = "src/lib/app-version.ts"
    p, s = rw(rel)
    s2, n1 = re.subn(r"(WEB_VERSION\s*=\s*)'[^']*'", r"\g<1>'%s'" % target, s, count=1)
    s3, n2 = re.subn(r"(WEB_BUILD\s*=\s*)\d+", r"\g<1>%d" % build, s2, count=1)
    assert n1 == 1 and n2 == 1, "WEB_VERSION/WEB_BUILD 没匹配到"
    write(p, s3)
    report(rel, True)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    target = sys.argv[1]
    if not re.fullmatch(r"\d+\.\d+\.\d+", target):
        print("版本号格式必须为 x.y.z")
        return 2
    try:
        build = int(sys.argv[2])
        if build < 1:
            raise ValueError("build must be positive")
    except ValueError:
        print("build 必须是整数")
        return 2

    for fn in (
        lambda: patch_package_json(target),
        lambda: patch_build_gradle(target, build),
        lambda: patch_capacitor_ts(target),
        lambda: patch_capacitor_json(target),
        lambda: patch_app_update_ts(target, build),
    ):
        try:
            fn()
        except Exception as e:  # 不中断其余文件
            report(str(fn), False, "%s: %s" % (type(e).__name__, e))

    print("=== patch 结果 ===")
    bad = 0
    for name, ok, detail in results:
        print("  " + ("OK   " if ok else "FAIL ") + name + ("  <- " + detail if detail else ""))
        if not ok:
            bad += 1
    if bad:
        print("\n有 %d 个文件没改成功，请手动修并 grep 复核" % bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
