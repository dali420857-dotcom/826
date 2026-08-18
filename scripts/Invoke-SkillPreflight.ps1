[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$skillRoot = Join-Path $Root '.agents/skills'
$lockPath = Join-Path $Root 'skills-lock.json'
$failures = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()
$skillIndex = [System.Collections.Generic.List[object]]::new()
$sourceCounts = @{}
$mandatoryRouter = [pscustomobject]@{
    name = 'ask-matt'
    manifest = '.agents/skills/ask-matt/SKILL.md'
    policy = '.agents/skills/ask-matt/agents/openai.yaml'
    activation = 'every_task'
    order = 'after_local_preflight_before_other_work'
    ready = $false
}
$mandatoryEngineeringRouter = [pscustomobject]@{
    name = 'using-agent-skills'
    manifest = '.agents/skills/using-agent-skills/SKILL.md'
    activation = 'every_task'
    order = 'after_ask_matt_before_other_work'
    source = 'mattpocock/skills'
    skill_count = 0
    ready = $false
}

function Add-Failure([string]$Message) {
    [void]$failures.Add($Message)
}

function Add-Warning([string]$Message) {
    [void]$warnings.Add($Message)
}

function Read-FrontmatterValue([string]$Content, [string]$Key) {
    $match = [regex]::Match($Content, "(?m)^$([regex]::Escape($Key)):\s*(.+?)\s*$")
    if (-not $match.Success) { return $null }
    return $match.Groups[1].Value.Trim().Trim('"', "'")
}

try {
    if (-not (Test-Path -LiteralPath $skillRoot -PathType Container)) {
        Add-Failure 'Project skill directory is missing: .agents/skills'
    }

    if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
        Add-Failure 'Skill lockfile is missing: skills-lock.json'
    }

    $lock = $null
    $lockEntries = @()
    if (Test-Path -LiteralPath $lockPath -PathType Leaf) {
        try {
            $lock = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json
            $lockEntries = @($lock.skills.psobject.Properties)
            if ($lock.version -ne 1 -or $lockEntries.Count -lt 1) {
                Add-Failure 'skills-lock.json has no valid locked skills.'
            }
        } catch {
            Add-Failure "Unable to parse skills-lock.json: $($_.Exception.Message)"
        }
    }

    $lockByName = @{}
    foreach ($entry in $lockEntries) {
        $lockByName[$entry.Name] = $entry.Value
    }

    $skillDirectories = if (Test-Path -LiteralPath $skillRoot -PathType Container) {
        @(Get-ChildItem -LiteralPath $skillRoot -Directory | Sort-Object Name)
    } else {
        @()
    }

    foreach ($directory in $skillDirectories) {
        $manifestPath = Join-Path $directory.FullName 'SKILL.md'
        if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
            Add-Failure "Skill manifest is missing: .agents/skills/$($directory.Name)/SKILL.md"
            continue
        }

        $content = Get-Content -Raw -LiteralPath $manifestPath
        $manifestName = Read-FrontmatterValue -Content $content -Key 'name'
        $description = Read-FrontmatterValue -Content $content -Key 'description'
        $lockEntry = if ($lockByName.ContainsKey($directory.Name)) { $lockByName[$directory.Name] } else { $null }
        if ($null -eq $lockEntry) {
            Add-Failure "Skill directory is not present in skills-lock.json: $($directory.Name)"
        }

        if ([string]::IsNullOrWhiteSpace($manifestName)) {
            Add-Warning "Skill manifest has no frontmatter name: $($directory.Name)"
            $manifestName = $directory.Name
        }

        $source = if ($null -ne $lockEntry) { [string]$lockEntry.source } else { 'unlocked' }
        if (-not $sourceCounts.ContainsKey($source)) { $sourceCounts[$source] = 0 }
        $sourceCounts[$source]++

        $shortDescription = if ([string]::IsNullOrWhiteSpace($description)) {
            $null
        } elseif ($description.Length -gt 160) {
            $description.Substring(0, 157) + '...'
        } else {
            $description
        }

        [void]$skillIndex.Add([pscustomobject]@{
                name = $manifestName
                source = $source
                manifest = ".agents/skills/$($directory.Name)/SKILL.md"
                description = $shortDescription
            })
    }

    $directoryNames = @($skillDirectories | ForEach-Object Name)
    foreach ($entry in $lockEntries) {
        if ($directoryNames -notcontains $entry.Name) {
            Add-Failure "Locked skill directory is missing: $($entry.Name)"
        }
    }

    if ($skillDirectories.Count -ne $lockEntries.Count) {
        Add-Failure "Project skill directory count ($($skillDirectories.Count)) does not match skills-lock.json ($($lockEntries.Count))."
    }

    $routerDirectory = Join-Path $skillRoot 'ask-matt'
    $routerManifestPath = Join-Path $routerDirectory 'SKILL.md'
    $routerPolicyPath = Join-Path $routerDirectory 'agents/openai.yaml'
    $routerReady = $true
    if (-not (Test-Path -LiteralPath $routerManifestPath -PathType Leaf)) {
        Add-Failure 'Mandatory task router manifest is missing: .agents/skills/ask-matt/SKILL.md'
        $routerReady = $false
    } else {
        $routerContent = Get-Content -Raw -LiteralPath $routerManifestPath
        $routerDisabled = Read-FrontmatterValue -Content $routerContent -Key 'disable-model-invocation'
        if ($routerDisabled -eq 'true') {
            Add-Failure 'Mandatory task router ask-matt has disable-model-invocation: true.'
            $routerReady = $false
        }
    }

    if (-not (Test-Path -LiteralPath $routerPolicyPath -PathType Leaf)) {
        Add-Failure 'Mandatory task router policy is missing: .agents/skills/ask-matt/agents/openai.yaml'
        $routerReady = $false
    } else {
        $routerPolicyContent = Get-Content -Raw -LiteralPath $routerPolicyPath
        if ($routerPolicyContent -notmatch '(?m)^\s*allow_implicit_invocation:\s*true\s*$') {
            Add-Failure 'Mandatory task router ask-matt must set allow_implicit_invocation: true.'
            $routerReady = $false
        }
    }

    if (@($skillIndex | Where-Object { $_.name -eq 'ask-matt' }).Count -ne 1) {
        Add-Failure 'Mandatory task router ask-matt is not uniquely present in the skill index.'
        $routerReady = $false
    }
    $mandatoryRouter.ready = $routerReady

    $engineeringRouterManifestPath = Join-Path $skillRoot 'using-agent-skills/SKILL.md'
    $engineeringRouterReady = $true
    if (-not (Test-Path -LiteralPath $engineeringRouterManifestPath -PathType Leaf)) {
        Add-Failure 'Mandatory agent-engineering router manifest is missing: .agents/skills/using-agent-skills/SKILL.md'
        $engineeringRouterReady = $false
    } else {
        $engineeringRouterContent = Get-Content -Raw -LiteralPath $engineeringRouterManifestPath
        $engineeringRouterDisabled = Read-FrontmatterValue -Content $engineeringRouterContent -Key 'disable-model-invocation'
        if ($engineeringRouterDisabled -eq 'true') {
            Add-Failure 'Mandatory agent-engineering router using-agent-skills has disable-model-invocation: true.'
            $engineeringRouterReady = $false
        }
    }

    if (@($skillIndex | Where-Object { $_.name -eq 'using-agent-skills' }).Count -ne 1) {
        Add-Failure 'Mandatory agent-engineering router using-agent-skills is not uniquely present in the skill index.'
        $engineeringRouterReady = $false
    }

    $engineeringSkillEntries = @($lockEntries | Where-Object { $_.Value.source -eq 'mattpocock/skills' })
    $mandatoryEngineeringRouter.skill_count = $engineeringSkillEntries.Count
    if ($engineeringSkillEntries.Count -lt 1) {
        Add-Failure 'No locked mattpocock/skills agent-engineering skills are available for routing.'
        $engineeringRouterReady = $false
    }
    $mandatoryEngineeringRouter.ready = $engineeringRouterReady
} catch {
    Add-Failure "Skill preflight failed unexpectedly: $($_.Exception.Message)"
}

$status = if ($failures.Count -gt 0) { 'error' } elseif ($warnings.Count -gt 0) { 'warning' } else { 'success' }
$summary = if ($status -eq 'success') {
    "Skill preflight passed: $($skillIndex.Count) project skills indexed with local lock coverage; mandatory ask-matt and using-agent-skills routers are ready."
} elseif ($status -eq 'warning') {
    "Skill preflight indexed $($skillIndex.Count) project skills with warnings."
} else {
    "Skill preflight blocked automatic skill activation: $($failures.Count) failure(s)."
}

$result = [pscustomobject]@{
    status = $status
    summary = $summary
    next_actions = if ($status -eq 'success') {
        @('Invoke ask-matt, then using-agent-skills to route the applicable agent-engineering skill before any other task work.', 'Keep external tools and mutations behind explicit approval gates.')
    } else {
        @('Stop task activation until the mandatory ask-matt and using-agent-skills routers and all lock or manifest failures are resolved.', 'Run pwsh -NoProfile -File .\scripts\Verify-Baseline.ps1 for the full project check.')
    }
    artifacts = [pscustomobject]@{
        skill_root = '.agents/skills'
        lockfile = 'skills-lock.json'
        skill_count = $skillIndex.Count
        source_counts = $sourceCounts
        skill_index = @($skillIndex)
        mandatory_router = $mandatoryRouter
        mandatory_agent_engineering_router = $mandatoryEngineeringRouter
        warnings = @($warnings)
        failures = @($failures)
        network_requests = $false
        external_mutations = $false
    }
}

$result | ConvertTo-Json -Depth 8
if ($status -eq 'error') { exit 1 }
