# Windows ECS website deployment

The current OHU website is deployed to the Windows Server 2022 ECS using the
existing Caddy service. The service is managed by MuMuLicense, so its service
definition and unrelated routes must be preserved.

## Current release

- Domain: `jouxyfwglzx.cn` and `www.jouxyfwglzx.cn`
- Release directory: `C:\OHUWebsite\releases\ohu-website-1.2.146-20261031\dist`
- Caddy executable: `C:\MuMuLicense\bin\caddy.exe`
- Existing configuration backup: `C:\OHUWebsite\backups\Caddyfile.pre-ohu-20261031.bak`
- Website archive: `artifacts/ohu-website-1.2.146-20261031.tar.gz`
- Archive SHA-256: `A47962F2BB4C7A04209C711A65C9A5BCE728E46DD29EEBC3AA631F2D4FDCE0E5`

The existing IP reverse-proxy site was retained. OHU is an additive hostname
block; Caddy was hot-reloaded without restarting the MuMuLicense Windows
service. The website is present on the server. Public requests are currently
blocked by Alibaba Cloud's ICP filing gate, so domain availability is pending
the filing step described in `docs/release/ALIBABA-CLOUD-DEPLOYMENT-PLAN.md`.

## Safe update outline

1. Build and archive the static output; record its SHA-256.
2. Upload to a new release directory and verify the archive hash before
   extraction.
3. Add the site block from `Caddyfile.ohu` to a copy of the current Caddyfile.
4. Run `caddy.exe validate` against the candidate configuration.
5. Back up the active Caddyfile, replace it atomically, then run
   `caddy.exe reload --config C:\MuMuLicense\Caddyfile --adapter caddyfile`.
6. Verify the current site, the existing IP reverse proxy, both domain names,
   the `/download/` assets, and HTTPS from outside the server.

Do not replace the Caddy service, overwrite its global options, alter the
MuMuLicense data directories, or expose credentials in deployment logs.
