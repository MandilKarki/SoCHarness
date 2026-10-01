param([switch]$ExpectNoSessions)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Net.Http
$origin='https://socharness-mandil.fly.dev'
$handler=New-Object System.Net.Http.HttpClientHandler
$handler.AllowAutoRedirect=$false
$client=New-Object System.Net.Http.HttpClient($handler)
$client.Timeout=[TimeSpan]::FromSeconds(90)
function Request($method,$path,$body=$null,$requestOrigin=$origin) {
    $request=New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::new($method),($origin+$path))
    if ($method -eq 'POST') {
        $request.Headers.Add('Origin',$requestOrigin)
        $request.Content=[System.Net.Http.StringContent]::new(($body|ConvertTo-Json -Compress),[Text.Encoding]::UTF8,'application/json')
    }
    try {
        $response=$client.SendAsync($request).GetAwaiter().GetResult()
        try { return @{status=[int]$response.StatusCode; text=$response.Content.ReadAsStringAsync().GetAwaiter().GetResult(); csp=$response.Headers.Contains('Content-Security-Policy')} }
        finally { $response.Dispose() }
    } finally { $request.Dispose() }
}
function Expect($response,$status) { if($response.status -ne $status){throw "Acceptance failed: expected HTTP $status, received $($response.status)"} }
try {
    Expect (Request GET '/api/health') 200
    Expect (Request GET '/') 303
    Expect (Request GET '/api/incidents') 401
    Expect (Request GET '/architecture') 303
    Expect (Request GET '/architecture.js') 401
    Expect (Request GET '/guide.js') 401
    Expect (Request POST '/api/login' @{token='invalid-test-token'}) 401
    $secure=Import-Clixml -LiteralPath (Join-Path $PSScriptRoot 'work/fly-operator-token.clixml')
    $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $login=Request POST '/api/login' @{token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)} }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    Expect $login 200
    if(!$login.csp){throw 'Missing security headers'}
    foreach($asset in @('/architecture','/architecture.js','/architecture.css','/guide.js','/guide.css')) { Expect (Request GET $asset) 200 }
    $atlas=Request GET '/architecture'
    if($atlas.text.Contains('<script>') -or $atlas.text.Contains('<style>') -or $atlas.text.Contains(' style=')){throw 'Architecture must use external CSP-compatible assets'}
    $inventory=Request GET '/api/inventory';Expect $inventory 200
    $metrics=($inventory.text|ConvertFrom-Json).metrics
    if($metrics.records -ne 155350 -or $metrics.cases -ne 7){throw 'Evidence/cohort count mismatch'}
    if($ExpectNoSessions -and $metrics.sessions -ne 0){throw 'Unexpected sessions in fresh pilot'}
    $adapters=Request GET '/api/adapters';Expect $adapters 200
    $items=$adapters.text|ConvertFrom-Json
    if(($items|Where-Object id -eq 'opencode').enabled){throw 'OpenCode must be disabled'}
    Expect (Request POST '/api/logout' @{} 'https://untrusted.invalid') 403
    Expect (Request POST '/api/logout' @{}) 200
    Expect (Request GET '/api/incidents') 401
    @{https=$true;login=$true;logout=$true;anonymous_denied=$true;cross_origin_denied=$true;metrics=$metrics}|ConvertTo-Json -Depth 4
} finally { $client.Dispose();$handler.Dispose() }
