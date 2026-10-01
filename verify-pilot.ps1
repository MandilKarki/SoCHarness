param([switch]$ExpectNoSessions,[switch]$ExpectFirebaseTrial,[string]$ExpectedTrialUntil,[string]$TokenFile=(Join-Path $PSScriptRoot 'work/fly-operator-token.clixml'))
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
    Expect (Request GET '/security') 303
    Expect (Request GET '/api/passkeys') 401
    Expect (Request GET '/experience.js') 401
    Expect (Request GET '/passkeys.js') 200
    Expect (Request GET '/identity.css') 200
    foreach($asset in @('/react-app.js','/react-app.css')) { Expect (Request GET $asset) 200 }
    $entry=Request GET '/login'
    if(!$entry.text.Contains('/react-app.js') -or $entry.text.Contains('src="/login.js"')){throw 'React login entry was not deployed'}
    Expect (Request POST '/api/passkeys/registration/options' @{}) 401
    Expect (Request POST '/api/passkeys/authentication/options' @{} 'https://untrusted.invalid') 403
    $options=Request POST '/api/passkeys/authentication/options' @{};Expect $options 200
    $publicKey=($options.text|ConvertFrom-Json).publicKey
    if($publicKey.rpId -ne 'socharness-mandil.fly.dev' -or $publicKey.userVerification -ne 'required'){throw 'Unexpected passkey RP or verification policy'}
    Expect (Request POST '/api/login' @{token='invalid-test-token'}) 401
    if($ExpectFirebaseTrial) {
        $auth=Request GET '/api/auth';Expect $auth 200
        if(($auth.text|ConvertFrom-Json).firebase.projectId -ne 'socharness'){throw 'Firebase not configured'}
        Expect (Request POST '/api/login/google' @{id_token='invalid-test-token'}) 401
        Expect (Request POST '/api/login/google' @{id_token='invalid-test-token'} 'https://untrusted.invalid') 403
    }
    $secure=Import-Clixml -LiteralPath $TokenFile
    $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $login=Request POST '/api/login' @{token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)} }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    Expect $login 200
    if(!$login.csp){throw 'Missing security headers'}
    foreach($page in @('/','/security')) {
        $react=Request GET $page;Expect $react 200
        if(!$react.text.Contains('/react-app.js') -or $react.text.Contains('src="/app.js"')){throw 'React workspace entry was not deployed'}
    }
    foreach($asset in @('/security','/security.js','/experience.js','/experience.css')) { Expect (Request GET $asset) 200 }
    $passkeys=Request GET '/api/passkeys';Expect $passkeys 200
    if(!(($passkeys.text|ConvertFrom-Json).recent_auth)){throw 'Fresh authentication missing'}
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
    if($ExpectFirebaseTrial) {
        $deployment=Request GET '/api/deployment';Expect $deployment 200
        $trial=($deployment.text|ConvertFrom-Json).trial
        if(!$trial.enabled -or $trial.limit_usd -ne 5 -or $trial.spendable_usd -ne 4.5 -or $trial.buffer_usd -ne 0.5){throw 'Trial guard missing'}
        if($ExpectedTrialUntil) {
            if([DateTimeOffset]::Parse($trial.expires_at) -ne [DateTimeOffset]::Parse($ExpectedTrialUntil)){throw 'Trial extension did not persist'}
            if($trial.requests -lt 2 -or $trial.accounted_usd -lt 0.100251 -or $trial.unsettled_requests -lt 1){throw 'Existing usage or reservations were lost'}
            $grid=$inventory.text|ConvertFrom-Json
            if($grid.rows.Count -ne 42 -or $grid.frameworks.Count -ne 11){throw 'Versioned matrix is incomplete'}
            foreach($row in $grid.rows) {
                foreach($framework in $grid.frameworks) {
                    $cell=$row.cells.($framework.id)
                    if(!$cell.mapping_id -or !$cell.pinned_version -or !$cell.live_status){throw 'Matrix cell lacks version/evidence metadata'}
                }
            }
        }
        if(($items|Where-Object { $_.id -notin @('simulator','openai') -and $_.available }).Count -gt 0){throw 'Another paid SDK bypasses trial policy'}
    }
    Expect (Request POST '/api/logout' @{} 'https://untrusted.invalid') 403
    Expect (Request POST '/api/logout' @{}) 200
    Expect (Request GET '/api/incidents') 401
    @{https=$true;login=$true;logout=$true;anonymous_denied=$true;cross_origin_denied=$true;passkey_management=$true;device_enrollment='requires user';metrics=$metrics;trial=$trial}|ConvertTo-Json -Depth 4
} finally { $client.Dispose();$handler.Dispose() }
