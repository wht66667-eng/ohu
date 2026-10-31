#!/usr/bin/env python3
"""Verify a device-build unsigned iOS IPA and emit the site's release manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import plistlib
import zipfile
from pathlib import Path, PurePosixPath


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ipa", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--build", required=True, type=int)
    args = parser.parse_args()

    ipa = args.ipa.resolve(strict=True)
    if ipa.suffix.lower() != ".ipa" or ipa.stat().st_size <= 0:
        raise SystemExit("Expected a non-empty .ipa file")

    with zipfile.ZipFile(ipa) as archive:
        bad_entry = archive.testzip()
        if bad_entry:
            raise SystemExit(f"Corrupt IPA entry: {bad_entry}")
        names = set(archive.namelist())
        plist_path = "Payload/App.app/Info.plist"
        if plist_path not in names:
            raise SystemExit("IPA is missing Payload/App.app/Info.plist")
        rejected_paths = sorted(name for name in names if name.lower().endswith(".mobileprovision") or "_CodeSignature" in PurePosixPath(name).parts)
        if rejected_paths:
            sample = "\n".join(f"  {name}" for name in rejected_paths[:8])
            omitted = f"\n  ... and {len(rejected_paths) - 8} more" if len(rejected_paths) > 8 else ""
            raise SystemExit(f"Expected an unsigned IPA without a provisioning profile or code signature; rejected {len(rejected_paths)} paths:\n{sample}{omitted}")
        info = plistlib.loads(archive.read(plist_path))
        executable = info.get("CFBundleExecutable")
        if not executable or f"Payload/App.app/{executable}" not in names:
            raise SystemExit("IPA is missing its app executable")
        actual = (
            info.get("CFBundleIdentifier"),
            info.get("CFBundleShortVersionString"),
            str(info.get("CFBundleVersion", "")),
            info.get("CFBundleDisplayName"),
        )
        expected = ("com.sunshinecampus.app", args.version, str(args.build), "哦狐")
        if actual != expected:
            raise SystemExit(f"IPA identity mismatch: expected {expected}, got {actual}")

    digest_builder = hashlib.sha256()
    with ipa.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest_builder.update(block)
    digest = digest_builder.hexdigest()
    filename = ipa.name
    manifest = {
        "app": "哦狐",
        "platform": "ios",
        "shell": "user",
        "status": "available",
        "message": "iPhone 安装包已完成构建；需要使用自签工具签名后安装。",
        "signed": False,
        "version": args.version,
        "build": args.build,
        "filename": filename,
        "url": f"/download/{filename}",
        "size": ipa.stat().st_size,
        "sha256": digest,
    }
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"filename": filename, "size": manifest["size"], "sha256": digest}, ensure_ascii=False))


if __name__ == "__main__":
    main()
