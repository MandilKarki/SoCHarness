param([string]$Python = 'python', [string]$Node = 'node')
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    & $Python -c 'import sys; assert sys.version_info >= (3,11), "Python 3.11+ required"'
    if ($LASTEXITCODE -ne 0) { throw 'Choose Python 3.11+ with -Python.' }
    & $Node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22||(a===22&&b<19))throw Error("Node 22.19+ required")'
    if ($LASTEXITCODE -ne 0) { throw 'Choose Node 22.19+ with -Node.' }
    $env:RELAY_NODE = (Get-Command $Node).Source
    if (!(Test-Path -LiteralPath '.venv-agents/Scripts/python.exe')) {
        & $Python -m venv .venv-agents
        if ($LASTEXITCODE -ne 0) { throw 'Virtual environment creation failed.' }
    }
    & '.\.venv-agents\Scripts\python.exe' -m pip install --no-cache-dir -r requirements-agents.lock
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency install failed.' }
    Push-Location workers/agent-bridge
    $relayPriorPath = $env:Path
    try {
        $env:Path = (Split-Path $env:RELAY_NODE) + [IO.Path]::PathSeparator + $relayPriorPath
        # npm 12 correctly applies the patched override to Pi's published shrinkwrap.
        & npm exec --yes --package=npm@12.2.0 --cache ../../work/npm-cache -- npm ci --ignore-scripts --no-fund --cache ../../work/npm-cache
        if ($LASTEXITCODE -ne 0) { throw 'Node dependency install failed.' }
    } finally { $env:Path = $relayPriorPath; Pop-Location }
    Write-Output 'Installed SDKs. Configure server environment credentials and run start.ps1. No model call made.'
} finally { Pop-Location }
