param([Parameter(Mandatory=$true)][string]$TokenFile, [switch]$Workbench, [switch]$Manager)
# ONE paid, bounded read-only lesson. No automatic retry; secrets remain in memory.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Net.Http
$origin='https://socharness-mandil.fly.dev'
$handler=New-Object System.Net.Http.HttpClientHandler
$handler.AllowAutoRedirect=$false
$client=New-Object System.Net.Http.HttpClient($handler)
$client.Timeout=[TimeSpan]::FromSeconds(200)
function Request($method,$path,$body=$null) {
    $request=[System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($method),$origin+$path)
    if($method -eq 'POST') {
        $request.Headers.Add('Origin',$origin)
        $request.Content=[System.Net.Http.StringContent]::new(($body|ConvertTo-Json -Depth 8 -Compress),[Text.Encoding]::UTF8,'application/json')
    }
    try {
        $response=$client.SendAsync($request).GetAwaiter().GetResult()
        try {
            if(!$response.IsSuccessStatusCode){throw "Lesson HTTP $([int]$response.StatusCode); no automatic retry."}
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
    if(!$budget.enabled -or $budget.blocked -or $budget.remaining_usd -lt $(if($Manager){0.4}else{0.3})){throw 'Guard unavailable; no model call made'}
    $inventory=Request GET '/api/inventory'|ConvertFrom-Json
    $disabled=@($inventory.tools|Where-Object name -ne 'query_case_evidence'|ForEach-Object {$_.name})
    if($disabled.Count -lt 6){throw 'Tool inventory incomplete; no model call made'}
    $session=Request POST '/api/sessions' @{case_id='IR-2841';config=@{
        runtime='openai';openai_experiment=$(if($Manager){'manager'}else{'core'});model=$budget.model;permission='read_only';max_turns=$(if($Manager){4}else{3});max_output_tokens=$(if($Workbench){1000}else{700});
        structured_output=[bool]$Workbench;memory=$false;skills=$false;artifacts=$false;specialists=$false;file_workspace=$false;disabled_tools=$disabled
    }}|ConvertFrom-Json
    $prompt=if($Manager){'Delegate this investigation to the evidence specialist exactly once. Have it query three case records and return concise findings with IDs. Then synthesize the specialist findings into the required answer in at most 150 words. Do not delegate again or perform writes.'}else{'Call query_case_evidence exactly once with {"limit":3,"search":""}. Then summarize only the returned records in at most 150 words. Cite their record IDs, separate observations from hypotheses, and state one limitation. Do not request more evidence or perform writes.'}
    $lines=Request POST ('/api/sessions/'+$session.id+'/messages') @{message=$prompt}
    $events=@($lines -split "`n"|Where-Object {$_.Trim()}|ForEach-Object {$_|ConvertFrom-Json})
    $completed=@($events|Where-Object kind -eq 'run.completed').Count -eq 1
    $results=@($events|Where-Object {$_.kind -eq 'tool.result' -and $_.payload.tool -eq 'query_case_evidence'})
    $answer=@($events|Where-Object {$_.kind -eq 'message.assistant' -and ([string]$_.payload.text).Trim().Length -gt 0}).Count -eq 1
    $recordIds=@($results|ForEach-Object {$_.payload.result.items}|ForEach-Object {$_.id})
    $settled=@($events|Where-Object kind -eq 'budget.settled')
    $captured=@($events|Where-Object kind -eq 'model.request')
    $returned=@($events|Where-Object kind -eq 'model.response')
    $carried=@($captured|Where-Object {$_.payload.call -gt 1}|ForEach-Object {$_.payload.input}|Where-Object type -eq 'function_call_output').Count
    $typed=@($events|Where-Object {$_.kind -eq 'sdk.result' -and $_.payload.structured_output}).Count
    $after=(Request GET '/api/deployment'|ConvertFrom-Json).trial
    @{completed=$completed;session_id=$session.id;evidence_queries=$results.Count;record_ids=$recordIds;answer_present=$answer;
      model_requests=$after.requests-$budget.requests;settled_receipts=$settled.Count;
      captured_requests=$captured.Count;captured_responses=$returned.Count;carried_tool_outputs=$carried;typed_results=$typed;
      observed_agents=@($captured|ForEach-Object {$_.payload.agent}|Select-Object -Unique);
      delegated=@($events|Where-Object kind -eq 'agent.delegated').Count;returned_to_manager=@($events|Where-Object kind -eq 'agent.returned').Count;
      run_cost_usd=($settled|ForEach-Object {$_.payload.cost_usd}|Measure-Object -Sum).Sum;
      accounted_usd=$after.accounted_usd;remaining_usd=$after.remaining_usd;unsettled_requests=$after.unsettled_requests;
      failures=@($events|Where-Object kind -eq 'run.failed'|ForEach-Object {$_.payload.message})}|ConvertTo-Json -Depth 4
    if(!$completed -or $results.Count -ne 1 -or $recordIds.Count -ne 3 -or !$answer -or $settled.Count -lt 2){throw 'Lesson acceptance failed; inspect saved trace before any retry'}
    if($Workbench -and ($captured.Count -lt 2 -or $returned.Count -ne $captured.Count -or $carried -lt 1 -or $typed -ne 1)){throw 'Workbench observation acceptance failed; no automatic retry'}
    if($Manager -and ($captured.Count -ne 4 -or @($events|Where-Object kind -eq 'agent.returned').Count -ne 1 -or $settled.Count -ne 4)){throw 'Manager acceptance failed; no automatic retry'}
} finally {
    try {$null=Request POST '/api/logout' @{}} catch {}
    $client.Dispose();$handler.Dispose()
}
