param([switch]$Initialize, [switch]$CopyToken)
$ErrorActionPreference = 'Stop'
$credentialPath = Join-Path $PSScriptRoot 'work/fly-operator-token.clixml'
if ($Initialize) {
    if (Test-Path -LiteralPath $credentialPath) { throw 'Credential already exists; refusing to rotate implicitly.' }
    $randomBytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($randomBytes) } finally { $rng.Dispose() }
    $generatedToken = [Convert]::ToBase64String($randomBytes)
    $secureToken = ConvertTo-SecureString $generatedToken -AsPlainText -Force
    $secureToken | Export-Clixml -LiteralPath $credentialPath
    "RELAY_OPERATOR_TOKEN=$generatedToken" | fly secrets import --app socharness-mandil
    if ($LASTEXITCODE -ne 0) { throw 'Secret import failed. Encrypted local credential retained for recovery.' }
    $generatedToken = $null
    Write-Output 'Operator token installed. Its local copy is encrypted to this Windows user.'
} elseif ($CopyToken) {
    $secureToken = Import-Clixml -LiteralPath $credentialPath
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    try { Set-Clipboard -Value ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    Write-Output 'Token copied. Paste into the Relay login, then clear your clipboard. Never paste it in chat.'
} else {
    Write-Output 'Use -CopyToken to copy the DPAPI-protected local login token. Only the originating Windows user can decrypt it.'
}
