# Windows ECS website deployment

The current OHU website is deployed to the Windows Server 2022 ECS using the
existing Caddy service. The service is managed by MuMuLicense, so its service
definition and unrelated routes must be preserved.

## Current release

- Domain: `jouxyfwglzx.cn` and `www.jouxyfwglzx.cn`
- Release directory: `C:\OHUWebsite\releases\ohu-website-1.2.155-20261108\dist`
- Caddy executable: `C:\MuMuLicense\bin\caddy.exe`
- Active configuration: `C:\MuMuLicense\Caddyfile`
- Configuration backup before 1.2.155: `C:\OHUWebsite\backups\Caddyfile.pre-155-20261108-115526.bak`
- Website archive used for 1.2.155: `ohu-web-1.2.155-20261108.tar.gz` (61.5 MB)
- Archive SHA-256: `5F9C73C7A1E733EB15EC87E6E8E94EB09F895A2EAD20E0C4E5572713D4FD69E5`

The existing IP reverse-proxy site is retained. OHU is an additive hostname
block. Caddy is hot-reloaded with `caddy reload`; the MuMuLicense Windows
service and its data directories are never touched.

The 1.2.155 site includes the Android download page, the iOS unsigned IPA
(`download/Ohhu-user-1.2.155-155-unsigned.ipa`), the version announcement bar
and `update.json`. Android APK bytes stay on CloudBase; the download page links
to the CloudBase URL, so the custom domain never has to host APKs.

## Safe update with the committed script

`deploy-ecs.ps1` performs the whole sync on the server and is safe to rerun for
a new version:

1. Build the site bundle locally from `.release-out/web-upload` plus
   `.release-out/apk-upload-manifest/update.json`, then `tar -czf`.
2. Record the archive SHA-256 and upload it to
   `C:\OHUWebsite\incoming\` on the ECS (scp over the existing SSH key).
3. Run on the ECS:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File C:\OHUWebsite\incoming\deploy-ecs.ps1 `
     -Version 1.2.155 `
     -Archive C:\OHUWebsite\incoming\ohu-web-1.2.155-20261108.tar.gz `
     -Sha256 5F9C73C7A1E733EB15EC87E6E8E94EB09F895A2EAD20E0C4E5572713D4FD69E5
   ```

The script verifies the hash, extracts into
`C:\OHUWebsite\releases\ohu-website-<version>\dist`, rewrites only the
`root * .../dist` line for the OHU site, runs `caddy validate` on a candidate,
backs up the active Caddyfile, reloads Caddy, and verifies the site through the
local Caddy listener with SNI.

## Rollback

Restore the recorded backup and reload:

```powershell
Copy-Item C:\OHUWebsite\backups\Caddyfile.pre-155-20261108-115526.bak C:\MuMuLicense\Caddyfile -Force
C:\MuMuLicense\bin\caddy.exe reload --config C:\MuMuLicense\Caddyfile --adapter caddyfile
```

Previous release directories are kept, so rolling back is only a Caddyfile root
change.

Do not replace the Caddy service, overwrite its global options, alter the
MuMuLicense data directories, or expose credentials in deployment logs.
