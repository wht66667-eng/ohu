#!/usr/bin/env python3
"""把目录/文件送到系统回收站（可恢复），而不是永久删除。

为什么需要它：
- 本环境 PowerShell 的 `Add-Type` 被安全策略拦（"compiles and loads .NET code at runtime"），
  走不了 VisualBasic.FileIO 的 SendToRecycleBin。
- `cmd rmdir /s /q` / `Remove-Item` 都是**永久删除**，对个人目录按安全策略禁止。
- send2trash 用的是 SHFileOperation + FOF_ALLOWUNDO，就是资源管理器按 Delete 的效果。

用法：
    python tools/trash-dir.py <路径> [<路径> ...]      # 真的送回收站
    python tools/trash-dir.py <路径> ... --dry-run     # 只报数量体积，不动

注意（踩过的坑）：
- 路径必须是**反斜杠**的 Windows 绝对路径。Git Bash 会把 `C:\\Users\\...` 里的反斜杠
  在传给原生 exe 时转成 `/`，send2trash 拼出 `\\\\?\\C:/...` 后报
  "系统找不到指定的文件"。所以不要靠 -c 内联，用本脚本 + 参数，并在脚本内 os.path.abspath 归一。
- 回收站有配额，超大目录（GB 级）可能被系统静默转为永久删除；本脚本会在 >2GB 时提示警告。
"""
import os
import sys

try:
    from send2trash import send2trash
except ImportError:
    sys.exit("需要先在隔离环境安装：python -m pip install send2trash")

WARN_BYTES = 2 * 1024 ** 3  # 2GB，超过就提醒回收站配额风险


def dir_stat(p):
    total = 0
    n = 0
    for root, _, files in os.walk(p):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
                n += 1
            except OSError:
                pass
    return total, n


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    if not args:
        sys.exit(__doc__)

    grand = 0
    for raw in args:
        p = os.path.abspath(os.path.expanduser(raw))
        if not os.path.exists(p):
            print("  跳过（不存在）: %s" % p)
            continue
        if os.path.isdir(p):
            total, n = dir_stat(p)
        else:
            total, n = os.path.getsize(p), 1
        grand += total
        flag = ""
        if total > WARN_BYTES:
            flag = "  <-- 超过 2GB，回收站可能放不下！"
        print("  %8.1f MB  %6d 文件  %s%s" % (total / 1024 ** 2, n, p, flag))
        if dry:
            continue
        try:
            send2trash(p)
        except Exception as e:
            print("    失败: %s: %s" % (type(e).__name__, e))
            continue
        print("    -> %s" % ("已送回收站" if not os.path.exists(p) else "仍存在！"))

    print("\n合计 %.2f GB%s" % (grand / 1024 ** 3, "（dry-run，未执行）" if dry else ""))


if __name__ == "__main__":
    main()
