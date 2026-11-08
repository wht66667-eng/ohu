param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Archive,
  [Parameter(Mandatory = $true)][string]$Sha256
)
# 哦狐官网（jouxyfwglzx.cn）Windows ECS 同步脚本。
# 用法（在 ECS 上以 Administrator 运行）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File deploy-ecs.ps1 `
#     -Version 1.2.155 -Archive C:\OHUWebsite\incoming\ohu-web-1.2.155-20261108.tar.gz -Sha256 <sha256>
# 行为：校验归档 → 解压到新版本目录 → 生成候选 Caddy 配置 → validate → 备份并替换 → 热重载 → 本机回环验证。
# 只改 jouxyfwglzx.cn 站点的 root；不动 IP 反代、MuMuLicense 服务与数据目录。
$ErrorActionPreference = 'Stop'
$expected = $Sha256.Trim().ToLower()
$releaseName = "ohu-website-$Version"
$releaseRoot = Join-Path 'C:\OHUWebsite\releases' $releaseName
$dist = Join-Path $releaseRoot 'dist'
$caddy = 'C:\MuMuLicense\bin\caddy.exe'
$config = 'C:\MuMuLicense\Caddyfile'
$backupDir = 'C:\OHUWebsite\backups'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$candidate = Join-Path $backupDir "Caddyfile.candidate-$Version-$stamp"

if (!(Test-Path $Archive)) { throw "archive missing: $Archive" }
$actual = (Get-FileHash $Archive -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected) { throw "archive hash mismatch: $actual" }

New-Item -ItemType Directory -Force -Path $dist | Out-Null
& tar.exe -xzf $Archive -C $dist
if ($LASTEXITCODE -ne 0) { throw "tar failed: $LASTEXITCODE" }
foreach ($required in @('download\student.html', 'download\index.html', 'update.json', 'download\ios-latest.json')) {
  if (!(Test-Path (Join-Path $dist $required))) { throw "missing after extract: $required" }
}

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$text = [IO.File]::ReadAllText($config)
$rootMatch = [regex]::Match($text, '(?m)^\s*root\s+\*\s+(\S+/dist)\s*$')
if (!$rootMatch.Success) { throw 'root directive not found in Caddyfile' }
$oldRoot = $rootMatch.Groups[1].Value
$newRoot = "C:/OHUWebsite/releases/$releaseName/dist"
if ($oldRoot -eq $newRoot) { throw "Caddy root already points to $newRoot" }
$candidateText = $text.Replace($oldRoot, $newRoot)
[IO.File]::WriteAllText($candidate, $candidateText, (New-Object System.Text.UTF8Encoding($false)))
& $caddy validate --config $candidate --adapter caddyfile
if ($LASTEXITCODE -ne 0) { throw 'candidate config invalid' }

$backup = Join-Path $backupDir "Caddyfile.pre-$Version-$stamp.bak"
Copy-Item $config $backup -Force
Copy-Item $candidate $config -Force
& $caddy reload --config $config --adapter caddyfile
if ($LASTEXITCODE -ne 0) {
  Copy-Item $backup $config -Force
  & $caddy reload --config $config --adapter caddyfile | Out-Null
  throw 'caddy reload failed; previous configuration restored'
}

$http = & curl.exe -s -o NUL -w '%{http_code}' --resolve www.jouxyfwglzx.cn:443:127.0.0.1 https://www.jouxyfwglzx.cn/download/
$update = & curl.exe -s --resolve jouxyfwglzx.cn:443:127.0.0.1 https://jouxyfwglzx.cn/update.json
$ios = & curl.exe -s --resolve www.jouxyfwglzx.cn:443:127.0.0.1 https://www.jouxyfwglzx.cn/download/ios-latest.json
[pscustomobject]@{
  release = $releaseRoot
  backup = $backup
  previousRoot = $oldRoot
  newRoot = $newRoot
  studentStatus = $http
  updateHasVersion = [bool]($update -match [regex]::Escape($Version))
  iosHasVersion = [bool]($ios -match [regex]::Escape($Version))
} | ConvertTo-Json -Compress
