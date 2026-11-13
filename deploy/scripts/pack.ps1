# Packs the project for the server, from Windows (PowerShell):
#   powershell -ExecutionPolicy Bypass -File deploy\scripts\pack.ps1
# → vibechat-release.tar.gz in the project folder. Left out: node_modules and build output, local
# data (apps/server/.local), every .env / .env.local (secrets stay on your machine), the
# certificates, and the local tunnel config. The server builds everything itself with Docker.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$out = Join-Path $root 'vibechat-release.tar.gz'
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path $tar)) { throw 'tar.exe not found (Windows 10 1803 or newer has it)' }
if (Test-Path $out) { Remove-Item $out -Force }

Push-Location $root
try {
  & $tar -czf $out `
    --exclude=node_modules --exclude=dist --exclude=.next --exclude=.local `
    --exclude=.env --exclude=.env.local --exclude=*.tsbuildinfo `
    --exclude=deploy/certs/*.pem --exclude=deploy/certs/*.key `
    apps deploy docs package.json README.md .dockerignore
  if ($LASTEXITCODE -ne 0) { throw "tar failed ($LASTEXITCODE)" }
} finally {
  Pop-Location
}
$mb = [math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Host "ready: $out ($mb MB)"
