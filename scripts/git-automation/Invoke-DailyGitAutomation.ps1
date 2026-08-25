[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,

    [Parameter(Mandatory = $true)]
    [string]$NodePath,

    [Parameter(Mandatory = $true)]
    [string]$GitPath,

    [Parameter(Mandatory = $true)]
    [string]$GitHubCliPath,

    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$')]
    [string]$RunId = "scheduled-$([DateTimeOffset]::UtcNow.ToString('yyyyMMdd-HHmmss'))-$PID",

    [Parameter(ParameterSetName = 'DryRun')]
    [switch]$DryRun,

    [Parameter(ParameterSetName = 'Execute')]
    [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'daily-git-automation.mjs'
$requiredExecutables = @{
    node = $NodePath
    git = $GitPath
    github_cli = $GitHubCliPath
}
foreach ($entry in $requiredExecutables.GetEnumerator()) {
    if (-not (Test-Path -LiteralPath $entry.Value -PathType Leaf)) {
        throw "Required executable is missing: $($entry.Key)=$($entry.Value)"
    }
}
$pathEntries = @(
    (Split-Path -Parent $NodePath),
    (Split-Path -Parent $GitPath),
    (Split-Path -Parent $GitHubCliPath),
    ($env:PATH -split [IO.Path]::PathSeparator)
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
$env:PATH = $pathEntries -join [IO.Path]::PathSeparator

function New-Sha256Hex([string]$Value) {
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
        return ([BitConverter]::ToString($sha256.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha256.Dispose()
    }
}

function New-ChildRunId([string]$ParentRunId, [string]$RepositoryId, [int]$Index) {
    $digest = New-Sha256Hex "$ParentRunId|$Index|$RepositoryId"
    $indexPart = ($Index + 1).ToString([Globalization.CultureInfo]::InvariantCulture)
    $digestLength = 16
    $availableIdLength = 80 - $ParentRunId.Length - $indexPart.Length - 3 - $digestLength
    if ($availableIdLength -gt 0) {
        $idPart = $RepositoryId.Substring(0, [Math]::Min($availableIdLength, $RepositoryId.Length))
        $candidate = "$ParentRunId-$indexPart-$idPart-$($digest.Substring(0, $digestLength))"
    } else {
        $candidate = "fleet-$($digest.Substring(0, 64))"
    }
    if ($candidate -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') {
        throw "Unable to create a safe child run id for repository '$RepositoryId'."
    }
    return $candidate
}

function Resolve-FleetPath([string]$Value, [string]$ConfigDirectory) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw 'Fleet repository configPath is required.'
    }
    $expanded = [Environment]::ExpandEnvironmentVariables($Value)
    if ([IO.Path]::IsPathRooted($expanded)) {
        return (Resolve-Path -LiteralPath $expanded).Path
    }
    return (Resolve-Path -LiteralPath (Join-Path $ConfigDirectory $expanded)).Path
}

function Read-JsonResult([object[]]$Output) {
    for ($index = $Output.Count - 1; $index -ge 0; $index--) {
        $line = [string]$Output[$index]
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }
        try {
            $candidate = $line | ConvertFrom-Json -Depth 20
            if ($null -ne $candidate -and -not [string]::IsNullOrWhiteSpace([string]$candidate.status)) {
                return $candidate
            }
        } catch {
            # Native child diagnostics can share the redirected stream.  Only
            # the final JSON result is part of the fleet contract.
        }
    }
    return $null
}

function New-BlockedChildResult([string]$Id, [string]$ChildConfigPath, [string]$ChildRunId, [int]$ExitCode, [string]$Summary) {
    return [ordered]@{
        id = $Id
        config_path = $ChildConfigPath
        run_id = $ChildRunId
        exit_code = $ExitCode
        status = 'blocked'
        summary = $Summary
    }
}

$resolvedFleetConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
$fleetDirectory = Split-Path -Parent $resolvedFleetConfig
$results = [System.Collections.Generic.List[object]]::new()
$entries = @()
$aggregateStatus = 'blocked'
$aggregateSummary = 'fleet_failed'
$aggregateError = $null

try {
    $fleet = Get-Content -Raw -LiteralPath $resolvedFleetConfig | ConvertFrom-Json -Depth 20
    if ($null -eq $fleet -or $null -eq $fleet.enabled -or $fleet.enabled -ne $true) {
        throw 'fleet_automation_disabled'
    }
    $entries = @($fleet.repositories)
    if ($entries.Count -eq 0) {
        throw 'fleet_repositories_required'
    }

    $seenIds = @{}
    $seenConfigs = @{}
    $normalizedEntries = @()
    foreach ($entry in $entries) {
        $id = [string]$entry.id
        if ($id -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') {
            throw "invalid_fleet_repository_id:$id"
        }
        if ($seenIds.ContainsKey($id)) {
            throw "duplicate_fleet_repository_id:$id"
        }
        $seenIds[$id] = $true
        $childConfigPath = Resolve-FleetPath ([string]$entry.configPath) $fleetDirectory
        $configKey = $childConfigPath.ToLowerInvariant()
        if ($seenConfigs.ContainsKey($configKey)) {
            throw "duplicate_fleet_config_path:$childConfigPath"
        }
        $seenConfigs[$configKey] = $true
        $normalizedEntries += [pscustomobject]@{
            id = $id
            config_path = $childConfigPath
        }
    }
    $entries = @($normalizedEntries)

    foreach ($entry in $entries) {
        $childRunId = New-ChildRunId $RunId ([string]$entry.id) $results.Count
        $childArguments = @(
            $scriptPath,
            '--config',
            ([string]$entry.config_path),
            '--run-id',
            $childRunId
        )
        if ($DryRun) {
            $childArguments += '--dry-run'
        } elseif ($Execute) {
            $childArguments += '--execute'
        } else {
            $childArguments += '--dry-run'
        }

        $childExitCode = 2
        $childResult = $null
        try {
            $childOutput = @(& $NodePath @childArguments 2>&1)
            $childExitCode = [int]$LASTEXITCODE
            $childResult = Read-JsonResult $childOutput
        } catch {
            $childResult = $null
            $childExitCode = 2
        }

        if ($null -eq $childResult) {
            [void]$results.Add((New-BlockedChildResult ([string]$entry.id) ([string]$entry.config_path) $childRunId $childExitCode 'child_result_unparseable'))
            continue
        }
        [void]$results.Add([ordered]@{
                id = [string]$entry.id
                config_path = [string]$entry.config_path
                run_id = $childRunId
                exit_code = $childExitCode
                status = [string]$childResult.status
                summary = [string]$childResult.summary
                result = $childResult
            })
    }

    $allVerified = $results.Count -eq $entries.Count -and @($results | Where-Object { $_.status -ne 'verified' -or $_.exit_code -ne 0 }).Count -eq 0
    if ($allVerified) {
        $aggregateStatus = 'verified'
        $aggregateSummary = 'fleet_verified'
    } else {
        $aggregateSummary = 'fleet_partial_failure'
    }
} catch {
    $aggregateError = $_.Exception.Message
    $aggregateSummary = $aggregateError
}

$aggregate = [ordered]@{
    status = $aggregateStatus
    summary = $aggregateSummary
    run_id = $RunId
    config_path = $resolvedFleetConfig
    repository_count = $entries.Count
    results = @($results)
}
if ($null -ne $aggregateError) {
    $aggregate.error = $aggregateError
}

$aggregate | ConvertTo-Json -Depth 20 -Compress
if ($aggregateStatus -eq 'verified') {
    exit 0
}
exit 2
