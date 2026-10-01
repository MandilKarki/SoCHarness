param([Parameter(Mandatory=$true)][string]$TokenFile)
# Makes ONE bounded live investigation, subject to the server's persistent trial
# reservations. Never reads the model key and never prints credentials or output.
$ErrorActionPreference='Stop'
$origin='https://socharness-mandil.fly.dev'
$handler=[System.Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect=$false
$client=[System.Net.Http.HttpClient]::new($handler)
$client.Timeout=[TimeSpan]::FromSeconds(200)
function Request($method,$path,$body=$null) {
    $request=[System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($method),$origin+$path)
    if($method -eq 'POST') {
        $request.Headers.Add('Origin',$origin)
        $request.Content=[System.Net.Http.StringContent]::new(($body|ConvertTo-Json -Depth 6 -Compress),[Text.Encoding]::UTF8,'application/json')
    }
    try {
        $response=$client.SendAsync($request).GetAwaiter().GetResult()
        try {
            if(!$response.IsSuccessStatusCode){throw "Pilot request failed with HTTP $([int]$response.StatusCode); inspect the app."}
            return $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        } finally {$response.Dispose()}
    } finally {$request.Dispose()}
}
try {
    $secure=Import-Clixml -LiteralPath $TokenFile
    $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {$null=Request POST '/api/login' @{token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)}}
    finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
    $budget=(Request GET '/api/deployment'|ConvertFrom-Json).trial
    if(!$budget.enabled -or $budget.blocked -or $budget.remaining_usd -lt 0.1){throw 'Trial is not available; no model call made'}
    $session=Request POST '/api/sessions' @{case_id='IR-2841';config=@{
        runtime='openai';model=$budget.model;permission='read_only';max_turns=2;max_output_tokens=256;
        disabled_tools=@('query_case_evidence','get_event','list_tasks','ask_human','save_case_note','simulate_containment','set_task')
    }} | ConvertFrom-Json
    $lines=Request POST ('/api/sessions/'+$session.id+'/messages') @{message='Connectivity smoke test only. Do not use tools or claim to review evidence. Reply: Relay LLM connection is ready.'}
    $events=@($lines -split "`n"|Where-Object {$_.Trim()}|ForEach-Object {$_|ConvertFrom-Json})
    $completed=@($events|Where-Object kind -eq 'run.completed').Count -eq 1
    $failure=$events|Where-Object kind -eq 'run.failed'|Select-Object -Last 1
    $category='none'
    if($failure) {
        $message=[string]$failure.payload.message
        $category=if($message.StartsWith('OpenAI API credits')){'billing_or_quota'}elseif($message.StartsWith('OpenAI rejected')){'credential'}elseif($message.StartsWith('The configured OpenAI')){'model_or_project_access'}elseif($message.StartsWith('OpenAI rate limit')){'rate_limit'}elseif($message.StartsWith('The OpenAI connection')){'transport'}else{'inspect_trace'}
    }
    $after=(Request GET '/api/deployment'|ConvertFrom-Json).trial
    @{completed=$completed;session_id=$session.id;failure_category=$category;requests=$after.requests;
      accounted_usd=$after.accounted_usd;remaining_usd=$after.remaining_usd;unsettled_requests=$after.unsettled_requests} | ConvertTo-Json
    $null=Request POST '/api/logout' @{}
    if(!$completed){exit 2}
} finally {$client.Dispose();$handler.Dispose()}
