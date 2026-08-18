[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$HermesHome = $env:HERMES_HOME,
    [switch]$ProbeLoopback
)

$ErrorActionPreference = 'Stop'
$failures = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

function Add-Failure([string]$Message) {
    [void]$failures.Add($Message)
}

function Add-Warning([string]$Message) {
    [void]$warnings.Add($Message)
}

$roleRelative = '.codex/agents/hermes-research-coordinator.toml'
$rolePath = Join-Path $Root $roleRelative
$codexRelative = '.codex/config.toml'
$codexPath = Join-Path $Root $codexRelative

if (-not (Test-Path -LiteralPath $rolePath -PathType Leaf)) {
    Add-Failure "Missing Hermes role configuration: $roleRelative"
} else {
    $roleContent = Get-Content -Raw -LiteralPath $rolePath
    foreach ($marker in @(
            'sandbox_mode = "read-only"',
            'Invoke-SkillPreflight.ps1',
            'Invoke-HermesResearchPreflight.ps1',
            'Do not edit files',
            'contract_only_not_live',
            'mutation_applied=false',
            'external_mutations=false',
            'credentials_accessed=false'
        )) {
        if (-not $roleContent.Contains($marker)) {
            Add-Failure "Hermes role marker missing: $marker"
        }
    }
}

if (-not (Test-Path -LiteralPath $codexPath -PathType Leaf)) {
    Add-Failure "Missing Codex configuration: $codexRelative"
} else {
    $codexContent = Get-Content -Raw -LiteralPath $codexPath
    foreach ($marker in @(
            'multi_agent_v2 = true',
            '[agents.hermes_research_coordinator]',
            'config_file = "agents/hermes-research-coordinator.toml"'
        )) {
        if (-not $codexContent.Contains($marker)) {
            Add-Failure "Codex Hermes marker missing: $marker"
        }
    }
}

$hermesConfigPresent = $false
$loopbackConfigured = $false
$a2aEnabled = $false
$endpoint = '127.0.0.1:8642'
$probeStatus = 'not_requested'

if (-not [string]::IsNullOrWhiteSpace($HermesHome)) {
    $hermesConfigPath = Join-Path $HermesHome 'config.yaml'
    if (-not (Test-Path -LiteralPath $hermesConfigPath -PathType Leaf)) {
        Add-Warning 'HERMES_HOME was supplied, but config.yaml was not found; keeping the adapter contract-only.'
    } else {
        $hermesConfigPresent = $true
        $hermesConfig = Get-Content -Raw -LiteralPath $hermesConfigPath
        $loopbackConfigured = $hermesConfig -match '(?ms)127\.0\.0\.1.*8642|8642.*127\.0\.0\.1'
        # Match only the gateway.platforms.a2a block; other enabled=true values
        # (for example MOA or MCP entries) must not be mistaken for A2A.
        $a2aEnabled = $hermesConfig -match '(?m)^    a2a:\s*\r?\n      enabled:\s*true\s*$'
        if ($ProbeLoopback) {
            if (-not $loopbackConfigured) {
                Add-Warning 'Loopback probe requested, but the supplied Hermes config does not prove the expected loopback endpoint.'
                $probeStatus = 'not_proven'
            } else {
                try {
                    $health = Invoke-WebRequest -UseBasicParsing -Method Get -Uri 'http://127.0.0.1:8642/health' -TimeoutSec 5
                    if ($health.StatusCode -ge 200 -and $health.StatusCode -lt 300) {
                        $probeStatus = 'verified'
                    } else {
                        Add-Warning "Loopback health probe returned HTTP $($health.StatusCode)."
                        $probeStatus = 'unverified'
                    }
                } catch {
                    Add-Warning "Loopback health probe failed; no Hermes delegation will be attempted: $($_.Exception.Message)"
                    $probeStatus = 'unverified'
                }
            }
        }
    }
}

$adapterStatus = if ($probeStatus -eq 'verified') { 'loopback_verified' } else { 'contract_only_not_live' }
$status = if ($failures.Count -gt 0) { 'error' } elseif ($warnings.Count -gt 0) { 'warning' } else { 'success' }
$summary = if ($status -eq 'error') {
    "Hermes research coordinator preflight blocked: $($failures.Count) failure(s)."
} elseif ($adapterStatus -eq 'loopback_verified') {
    'Hermes research coordinator contract passed and the explicitly requested loopback health check succeeded.'
} else {
    'Hermes research coordinator contract passed; live Hermes delegation remains disabled until an explicit loopback probe and readback succeed.'
}

$result = [pscustomobject]@{
    status = $status
    summary = $summary
    next_actions = if ($status -eq 'error') {
        @('Fix the Hermes role/config contract before automatic delegation.', 'Keep the primary Codex agent in control of edits and final verification.')
    } elseif ($adapterStatus -eq 'contract_only_not_live') {
        @('Use this role for local read-only evidence work.', 'Only request -ProbeLoopback after explicit authorization; do not treat configuration as runtime proof.')
    } else {
        @('Require task-scoped authorization and endpoint readback before delegating research.', 'Keep child delegation bounded to three children at depth one.')
    }
    artifacts = [pscustomobject]@{
        role = 'hermes_research_coordinator'
        role_config = $roleRelative
        codex_config = $codexRelative
        preflight = 'local_read_only'
        adapter_status = $adapterStatus
        hermes_home_supplied = -not [string]::IsNullOrWhiteSpace($HermesHome)
        hermes_config_present = $hermesConfigPresent
        loopback_endpoint = $endpoint
        loopback_configured = $loopbackConfigured
        loopback_probe = $probeStatus
        a2a_enabled = $a2aEnabled
        max_parallel_children = 3
        max_depth = 1
        credentials_accessed = $false
        network_requests = [bool]$ProbeLoopback
        external_mutations = $false
        mutation_applied = $false
        warnings = @($warnings)
        failures = @($failures)
    }
}

$result | ConvertTo-Json -Depth 8
if ($status -eq 'error') { exit 1 }
