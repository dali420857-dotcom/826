[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,

    [string]$TaskName = 'Dali-Daily-Git-Automation-Fleet',

    [string[]]$DailyAt = @('01:00', '10:30', '16:30'),

    [ValidateSet('Interactive', 'S4U')]
    [string]$LogonType = 'Interactive',

    [string]$RequiredTimeZoneId = 'Pacific Standard Time',

    [ValidateRange(1, 24)]
    [int]$ExecutionTimeLimitHours = 2,

    [switch]$Register
)

$ErrorActionPreference = 'Stop'
$entrypoint = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'Invoke-DailyGitAutomation.ps1')).Path
$resolvedConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
$configDirectory = Split-Path -Parent $resolvedConfig

function Resolve-ExecutablePath([string]$Name) {
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -eq $command) {
        return $null
    }
    return (Resolve-Path -LiteralPath $command.Source).Path
}

function Quote-Argument([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return '""'
    }
    return '"{0}"' -f $Value.Replace('"', '\\"')
}

function Resolve-ConfigPath([string]$Value, [string]$BaseDirectory) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw 'config_path_required'
    }
    $expanded = [Environment]::ExpandEnvironmentVariables($Value)
    if ([IO.Path]::IsPathRooted($expanded)) {
        return (Resolve-Path -LiteralPath $expanded).Path
    }
    return (Resolve-Path -LiteralPath (Join-Path $BaseDirectory $expanded)).Path
}

function Test-EnabledTopLevelSchedule([string]$WorkflowPath) {
    if (-not (Test-Path -LiteralPath $WorkflowPath -PathType Leaf)) {
        return $false
    }
    $inOnBlock = $false
    foreach ($line in (Get-Content -LiteralPath $WorkflowPath)) {
        if ($line -match '^(?:''on''|on)\s*:') {
            $inOnBlock = $true
            if ($line -match '(?:''on''|on)\s*:\s*\{[^}]*\bschedule\s*:') {
                return $true
            }
            continue
        }
        if ($inOnBlock -and $line -match '^\S' -and $line -notmatch '^\s*#') {
            $inOnBlock = $false
        }
        if ($inOnBlock -and $line -match '^\s{2}schedule\s*:\s*(.*)$') {
            $value = $Matches[1].Trim()
            if ($value -notin @('null', '~', 'false', '[]', '{}')) {
                return $true
            }
        }
    }
    return $false
}

$fleet = Get-Content -Raw -LiteralPath $resolvedConfig | ConvertFrom-Json -Depth 20
if ($null -eq $fleet -or $fleet.enabled -ne $true) {
    throw 'fleet_automation_disabled'
}
$fleetEntries = @($fleet.repositories)
if ($fleetEntries.Count -eq 0) {
    throw 'fleet_repositories_required'
}

$executablePaths = [ordered]@{
    pwsh = Resolve-ExecutablePath 'pwsh'
    node = Resolve-ExecutablePath 'node'
    git = Resolve-ExecutablePath 'git'
    github_cli = Resolve-ExecutablePath 'gh'
}
$currentTimeZoneId = [TimeZoneInfo]::Local.Id
$conflicts = [System.Collections.Generic.List[string]]::new()
if ($currentTimeZoneId -ne $RequiredTimeZoneId) {
    [void]$conflicts.Add('host_timezone_mismatch')
}
foreach ($entry in $executablePaths.GetEnumerator()) {
    if ([string]::IsNullOrWhiteSpace($entry.Value)) {
        [void]$conflicts.Add("missing_executable_$($entry.Key)")
    }
}
if ($LogonType -eq 'S4U') {
    [void]$conflicts.Add('s4u_unattended_context_unverified')
}

$seenIds = @{}
$seenConfigs = @{}
$repositories = @()
foreach ($entry in $fleetEntries) {
    $id = [string]$entry.id
    if ($id -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') {
        throw "invalid_fleet_repository_id:$id"
    }
    if ($seenIds.ContainsKey($id)) {
        throw "duplicate_fleet_repository_id:$id"
    }
    $seenIds[$id] = $true

    $childConfigPath = Resolve-ConfigPath ([string]$entry.configPath) $configDirectory
    $configKey = $childConfigPath.ToLowerInvariant()
    if ($seenConfigs.ContainsKey($configKey)) {
        throw "duplicate_fleet_config_path:$childConfigPath"
    }
    $seenConfigs[$configKey] = $true

    $childConfig = Get-Content -Raw -LiteralPath $childConfigPath | ConvertFrom-Json -Depth 20
    if ($null -eq $childConfig -or $childConfig.enabled -ne $true) {
        throw "child_automation_disabled:$id"
    }
    $childConfigDirectory = Split-Path -Parent $childConfigPath
    $configuredRepositoryRoot = Resolve-ConfigPath ([string]$childConfig.repositoryRoot) $childConfigDirectory
    $repositoryRoot = $configuredRepositoryRoot
    if ($null -ne $executablePaths.git) {
        $gitRootOutput = & $executablePaths.git -C $configuredRepositoryRoot rev-parse --show-toplevel 2>&1
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($gitRootOutput -join ''))) {
            throw "repository_git_root_unresolved:$id"
        }
        $repositoryRoot = ($gitRootOutput -join "`n").Trim()
    }
    $repositoryRoot = (Resolve-Path -LiteralPath $repositoryRoot).Path
    $workflowPath = Join-Path $repositoryRoot '.github/workflows/automation.yml'
    $scheduleEnabled = Test-EnabledTopLevelSchedule $workflowPath
    if ($scheduleEnabled) {
        [void]$conflicts.Add("github_schedule_enabled:$id")
    }
    $repositories += [ordered]@{
        id = $id
        config_path = $childConfigPath
        repository_root = $repositoryRoot
        github_schedule_enabled = $scheduleEnabled
        workflow_path = $workflowPath
    }
}

$readiness = [ordered]@{
    ready = $conflicts.Count -eq 0
    conflicts = @($conflicts)
    current_timezone_id = $currentTimeZoneId
    required_timezone_id = $RequiredTimeZoneId
    repository_count = $repositories.Count
    repositories = @($repositories)
    executables = $executablePaths
}
$times = foreach ($time in $DailyAt) {
    $parsed = [DateTime]::MinValue
    if (-not [DateTime]::TryParseExact(
        $time,
        'HH:mm',
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::None,
        [ref]$parsed
    )) {
        throw "Invalid daily time: $time"
    }
    $parsed.ToString('HH:mm')
}

$argumentList = @(
    '-NoProfile',
    '-File',
    (Quote-Argument $entrypoint),
    '-ConfigPath',
    (Quote-Argument $resolvedConfig),
    '-NodePath',
    (Quote-Argument $executablePaths.node),
    '-GitPath',
    (Quote-Argument $executablePaths.git),
    '-GitHubCliPath',
    (Quote-Argument $executablePaths.github_cli),
    '-Execute'
) -join ' '

$plan = [ordered]@{
    status = if ($Register) { 'registering' } else { 'plan_only' }
    task_name = $TaskName
    executable = $executablePaths.pwsh
    arguments = $argumentList
    daily_at = @($times)
    logon_type = $LogonType
    readiness = $readiness
    settings = [ordered]@{
        start_when_available = $true
        wake_to_run = $true
        run_only_if_network_available = $true
        multiple_instances = 'IgnoreNew'
        execution_time_limit_hours = $ExecutionTimeLimitHours
    }
}

if (-not $Register) {
    $plan | ConvertTo-Json -Depth 8
    exit 0
}
if (-not $readiness.ready) {
    $plan.status = 'blocked'
    $plan | ConvertTo-Json -Depth 8
    exit 2
}

$action = New-ScheduledTaskAction -Execute $executablePaths.pwsh -Argument $argumentList
$triggers = foreach ($time in $times) {
    New-ScheduledTaskTrigger -Daily -At $time
}
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -WakeToRun `
    -RunOnlyIfNetworkAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours $ExecutionTimeLimitHours)
$principal = New-ScheduledTaskPrincipal `
    -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType $LogonType `
    -RunLevel Limited
$task = New-ScheduledTask `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Principal $principal `
    -Description 'Runs the isolated Git automation fleet without mutating primary worktrees.'

Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
$readback = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName

$mismatches = [System.Collections.Generic.List[string]]::new()
$readbackAction = @($readback.Actions) | Select-Object -First 1
if ($null -eq $readbackAction -or $readbackAction.Execute -ne $executablePaths.pwsh) {
    [void]$mismatches.Add('action_executable')
}
if ($null -eq $readbackAction -or $readbackAction.Arguments -ne $argumentList) {
    [void]$mismatches.Add('action_arguments')
}
$readbackLogonType = [string]$readback.Principal.LogonType
if ($readbackLogonType -notin @('Interactive', 'InteractiveToken')) {
    [void]$mismatches.Add('logon_type')
}
if ($readback.Settings.StartWhenAvailable -ne $true) {
    [void]$mismatches.Add('start_when_available')
}
if ($readback.Settings.WakeToRun -ne $true) {
    [void]$mismatches.Add('wake_to_run')
}
if ($readback.Settings.RunOnlyIfNetworkAvailable -ne $true) {
    [void]$mismatches.Add('run_only_if_network_available')
}
if ([string]$readback.Settings.MultipleInstances -ne 'IgnoreNew') {
    [void]$mismatches.Add('multiple_instances')
}
if ($readback.Settings.ExecutionTimeLimit -ne (New-TimeSpan -Hours $ExecutionTimeLimitHours)) {
    [void]$mismatches.Add('execution_time_limit')
}
if ($mismatches.Count -gt 0) {
    [ordered]@{
        status = 'blocked'
        summary = 'scheduled_task_readback_mismatch'
        task_name = $TaskName
        mismatches = @($mismatches)
        executable = $executablePaths.pwsh
        arguments = $argumentList
    } | ConvertTo-Json -Depth 5
    exit 2
}

[ordered]@{
    status = 'registered'
    task_name = $readback.TaskName
    state = [string]$readback.State
    next_run_time = $info.NextRunTime.ToString('o')
    last_task_result = $info.LastTaskResult
    daily_at = @($times)
    logon_type = $LogonType
    current_timezone_id = $currentTimeZoneId
    required_timezone_id = $RequiredTimeZoneId
    repository_count = $repositories.Count
    repositories = @($repositories)
    executable = $executablePaths.pwsh
    arguments = $argumentList
    executables = $executablePaths
} | ConvertTo-Json -Depth 8
