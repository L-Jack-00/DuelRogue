$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root
try {
  deno compile `
    --no-terminal `
    --allow-net=127.0.0.1 `
    --allow-read `
    --allow-write `
    --allow-env `
    --allow-run `
    --include index.html `
    --include main.js `
    --include style.css `
    --include src `
    --include assets `
    --output dist/DuelRogue.exe `
    tools/client_launcher.ts
} finally {
  Pop-Location
}
