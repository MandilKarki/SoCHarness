param(
    [Parameter(Mandatory=$true)][string]$Python,
    [string]$HermesPython
)
$ErrorActionPreference = 'Stop'
function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed: $Executable (exit $LASTEXITCODE)" }
}
Push-Location $PSScriptRoot
try {
    Invoke-Checked $Python @('-c', 'import sys; assert sys.version_info[:2] == (3,12), "Extended SDKs are tested on Python 3.12"')
    if (!(Test-Path -LiteralPath '.venv-extended/Scripts/python.exe')) {
        Invoke-Checked $Python @('-m','venv','.venv-extended')
    }
    $extendedPython = Join-Path $PSScriptRoot '.venv-extended/Scripts/python.exe'
    Invoke-Checked $extendedPython @('-m','pip','install','-r','workers/python-bridge/requirements.txt')
    Invoke-Checked $extendedPython @('-m','pip','check')
    Invoke-Checked $extendedPython @('-m','unittest','discover','-s','workers/python-bridge','-p','test_contracts.py','-v')
    if ($HermesPython) {
        Invoke-Checked $HermesPython @('-c','import sys; assert sys.version_info[:2] == (3,14), "Hermes requires Python 3.14"')
        $sourcePath = Join-Path $PSScriptRoot 'work/vendor/hermes-agent'
        $revision = 'a4bd966aeee27d4e26316d69f2d2355dc5f32c21'
        if (!(Test-Path -LiteralPath $sourcePath)) {
            Invoke-Checked 'git' @('clone','--filter=blob:none','https://github.com/NousResearch/hermes-agent.git',$sourcePath)
            Invoke-Checked 'git' @('-C',$sourcePath,'checkout','--detach',$revision)
        }
        $actual = & git -C $sourcePath rev-parse HEAD
        if ($LASTEXITCODE -ne 0 -or $actual -ne $revision) { throw 'Existing Hermes checkout is not the tested revision; it was left unchanged.' }
        if (!(Test-Path -LiteralPath '.venv-hermes/Scripts/python.exe')) { Invoke-Checked $HermesPython @('-m','venv','.venv-hermes') }
        $hermesEnvPython = Join-Path $PSScriptRoot '.venv-hermes/Scripts/python.exe'
        Invoke-Checked $hermesEnvPython @('-m','pip','install','-e',$sourcePath)
        Invoke-Checked $hermesEnvPython @('-m','pip','check')
        Invoke-Checked $hermesEnvPython @('-m','unittest','discover','-s','workers/python-bridge','-p','test_hermes.py','-v')
    }
    Write-Host 'SDK contracts passed. Configure provider keys server-side and restart Relay. No live provider calls were made.'
} finally { Pop-Location }
