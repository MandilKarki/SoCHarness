$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    $env:PYDANTIC_AI_NO_BANNER = '1'
    if (Test-Path -LiteralPath '.venv-agents\Scripts\python.exe') {
        & '.\.venv-agents\Scripts\python.exe' 'services/app.py'
    } elseif (Test-Path -LiteralPath '.venv\Scripts\python.exe') {
        & '.\.venv\Scripts\python.exe' 'services/app.py'
    } else {
        & python 'services/app.py'
    }
} finally {
    Pop-Location
}
