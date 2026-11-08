param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Archive,
  [Parameter(Mandatory = $true)][string]$Sha256
)
# 在不切换 Caddy root 的前提下，用新归档覆盖当前版本目录的静态文件。
# 适用于「同一版本追加/修正官网内容」（例如补上 iOS IPA、改下载页文案）。
$ErrorActionPreference = 'Stop'
$expected = $Sha256.Trim().ToLower()
$dist = "C:\OHUWebsite\releases\ohu-website-$Version\dist"
if (!(Test-Path $dist)) { throw "release directory missing: $dist" }
if (!(Test-Path $Archive)) { throw "archive missing: $Archive" }
$actual = (Get-FileHash $Archive -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected) { throw "archive hash mismatch: $actual" }
& tar.exe -xzf $Archive -C $dist
if ($LASTEXITCODE -ne 0) { throw "tar failed: $LASTEXITCODE" }
$http = & curl.exe -s -o NUL -w '%{http_code}' --resolve www.jouxyfwglzx.cn:443:127.0.0.1 https://www.jouxyfwglzx.cn/download/
$ios = & curl.exe -s --resolve www.jouxyfwglzx.cn:443:127.0.0.1 https://www.jouxyfwglzx.cn/download/ios-latest.json
[pscustomobject]@{
  dist = $dist
  studentStatus = $http
  iosHasVersion = [bool]($ios -match [regex]::Escape($Version))
  iosAvailable = [bool]($ios -match '"status": "available"')
  ipaPresent = (Test-Path (Join-Path $dist "download\Ohhu-user-$Version-$($Version.Split('.')[-1])-unsigned.ipa"))
} | ConvertTo-Json -Compress
