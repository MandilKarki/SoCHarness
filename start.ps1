$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    if (!(Test-Path -LiteralPath 'web/react-app.js') -or !(Test-Path -LiteralPath 'web/react-app.css')) {
        throw 'Build the React frontend first: npm --prefix frontend ci; npm --prefix frontend run build:publish (Node 24.15+).'
    }
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
