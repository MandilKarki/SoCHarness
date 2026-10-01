param(
    [string]$Python=(Join-Path $PSScriptRoot '.venv-agents/Scripts/python.exe'),
    [string]$ExtendedPython=(Join-Path $PSScriptRoot '.venv-extended/Scripts/python.exe'),
    [string]$HermesPython=(Join-Path $PSScriptRoot '.venv-hermes/Scripts/python.exe'),
    [string]$Node='node'
)
# Offline contract runner. Does not load .env, install SDKs or run paid smoke tests.
# Missing runtimes and skipped test cases are INCOMPLETE, never PASS.
$ErrorActionPreference='Stop'
$keys=@('OPENAI_API_KEY','ANTHROPIC_API_KEY','GOOGLE_API_KEY','AI_GATEWAY_API_KEY','RELAY_OPERATOR_TOKEN','LANGSMITH_API_KEY','RELAY_MODE','RELAY_TRIAL_ENABLED','RELAY_TRIAL_UNTIL')
$saved=@{}
$checks=[Collections.Generic.List[object]]::new()
function Check($name,$binary,$arguments) {
    if(!(Test-Path -LiteralPath $binary) -and !(Get-Command $binary -ErrorAction SilentlyContinue)) {
        $checks.Add(@{suite=$name;status='incomplete';reason='Interpreter missing'});return
    }
    $prior=$ErrorActionPreference
    $ErrorActionPreference='Continue'
    try {
        $output=@(& $binary @arguments 2>&1)
        $code=$LASTEXITCODE
    } finally {$ErrorActionPreference=$prior}
    $text=$output -join "`n"
    $status=if($code -ne 0){'failed'}elseif($text -match 'skipped=[1-9]|# skipped [1-9]'){'incomplete'}else{'passed'}
    $checks.Add(@{suite=$name;status=$status;exit_code=$code})
    Write-Host ($name+': '+$status)
}
Push-Location $PSScriptRoot
try {
    foreach($key in $keys) { $saved[$key]=[Environment]::GetEnvironmentVariable($key,'Process');[Environment]::SetEnvironmentVariable($key,$null,'Process') }
    Check 'Manifest and pins' $Python @('services/sdk_release_check.py','--offline')
    Check 'Core contracts / policy / budget / auth' $Python @('-m','unittest','discover','-s','services','-p','test_*.py','-q')
    Check 'Pi / Vercel / OpenCode contracts' $Node @('--test','workers/agent-bridge/test/adapters.test.mjs')
    Check 'Google / Microsoft / OpenHands contracts' $ExtendedPython @('-m','unittest','discover','-s','workers/python-bridge','-p','test_contracts.py','-q')
    Check 'Hermes contracts' $HermesPython @('-m','unittest','discover','-s','workers/python-bridge','-p','test_hermes.py','-q')
    @{scope='Offline contract suites, not per-cell live acceptance';model_calls=0;checks=$checks.ToArray()} | ConvertTo-Json -Depth 5
    if(@($checks|Where-Object status -ne 'passed').Count){exit 1}
} finally {
    foreach($key in $keys){[Environment]::SetEnvironmentVariable($key,$saved[$key],'Process')}
    Pop-Location
}
