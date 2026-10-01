param([Parameter(Mandatory=$true)][string]$TokenFile)
# Read-only diagnostics after existing operator authentication. No model requests.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Net.Http
$origin='https://socharness-mandil.fly.dev'
$handler=New-Object System.Net.Http.HttpClientHandler
$client=New-Object System.Net.Http.HttpClient($handler)
$client.Timeout=[TimeSpan]::FromSeconds(90)
function Request($method,$path,$body=$null) {
    $request=New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::new($method),($origin+$path))
    if($method -eq 'POST') {
        $request.Headers.Add('Origin',$origin)
        $request.Content=[System.Net.Http.StringContent]::new(($body|ConvertTo-Json -Compress -Depth 8),[Text.Encoding]::UTF8,'application/json')
    }
    try {
        $response=$client.SendAsync($request).GetAwaiter().GetResult()
        try {
            if(!$response.IsSuccessStatusCode){throw ('Diagnostic HTTP '+[int]$response.StatusCode)}
            return $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()|ConvertFrom-Json
        } finally {$response.Dispose()}
    } finally {$request.Dispose()}
}
try {
    $secure=Import-Clixml -LiteralPath $TokenFile
    $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $null=Request POST '/api/login' @{token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)} }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $adapter=Request GET '/api/adapters' | Where-Object id -eq 'openai'
    $trial=(Request GET '/api/deployment').trial
    $sessions=@(Request GET '/api/sessions')
    $summary=@(foreach($s in ($sessions|Select-Object -First 12)) {
        $trace=(Request GET ('/api/sessions/'+$s.id)).trace
        @{id=$s.id;case_id=$s.case_id;runtime=$s.config.runtime;model=$s.config.model;status=$s.status;created_at=$s.created_at;
          events=$trace.Count;kinds=@($trace|Group-Object kind|ForEach-Object {@{kind=$_.Name;count=$_.Count}});
          failures=@($trace|Where-Object {$_.kind -in @('run.failed','run.cancelled','tool.failed')}|ForEach-Object {@{kind=$_.kind;message=$_.payload.message}})}
    })
    @{openai=$adapter;trial=$trial;sessions=$summary}|ConvertTo-Json -Depth 8
} finally {
    try {$null=Request POST '/api/logout' @{}} catch {}
    $client.Dispose();$handler.Dispose()
}
