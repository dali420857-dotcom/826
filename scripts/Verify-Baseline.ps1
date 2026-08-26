[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [switch]$SkipHostAutomationSurface
)

$ErrorActionPreference = 'Stop'
$failures = [System.Collections.Generic.List[string]]::new()

function Add-Failure([string]$Message) {
    [void]$failures.Add($Message)
}

function Require-File([string]$RelativePath) {
    $path = Join-Path $Root $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Add-Failure "Missing required file: $RelativePath"
    }
}

$requiredFiles = @(
    'README.md',
    'AGENTS.md',
    '.env.example',
    'config/project-baseline.yaml',
    'config/capabilities.yaml',
    'config/fallback-policy.yaml',
    'config/connectors.yaml',
    'config/observability.yaml',
    'config/storage.yaml',
    'config/knowledge-graph.yaml',
    'config/skill-registry.yaml',
    'config/negative-decisions.json',
    'config/negative-regression-gate.json',
    'scripts/Invoke-SkillPreflight.ps1',
    'scripts/Invoke-HermesResearchPreflight.ps1',
    'scripts/ci/negative-regression-gate.mjs',
    'config/web-clone-toolchain.yaml',
    'config/profiles/safe-default.yaml',
    'config/profiles/rapid-prototype.yaml',
    'graphs/system-context.mmd',
    'graphs/control-plane.mmd',
    'graphs/data-flow.mmd',
    'graphs/state-machine.mmd',
    'graphs/fallback-decision.mmd',
    'docs/architecture/agent-layers.md',
    'docs/agents/hermes-research-coordinator.md',
    'docs/operations/recovery-runbook.md',
    'docs/verification/baseline-acceptance.md',
    'docs/skills/README.md',
    'docs/website/konk-cc-public-inventory.md',
    'schemas/capability.schema.json',
    'schemas/fallback.schema.json',
    'schemas/graph.schema.json',
    'package.json',
    'tsconfig.json',
    'vite.config.ts',
    'vitest.config.ts',
    'playwright.config.ts',
    'eslint.config.js',
    'scripts/check-web-toolchain.mjs'
)

if (-not $SkipHostAutomationSurface) {
    $requiredFiles += @(
        '.codex/config.toml',
        '.codex/agents/explorer.toml',
        '.codex/agents/reviewer.toml',
        '.codex/agents/docs-researcher.toml',
        '.codex/agents/hermes-research-coordinator.toml',
        '.agents/skills/ask-matt/SKILL.md',
        '.agents/skills/ask-matt/agents/openai.yaml',
        '.agents/skills/using-agent-skills/SKILL.md'
    )
}

foreach ($file in $requiredFiles) { Require-File $file }

$negativeGatePath = Join-Path $Root 'scripts/ci/negative-regression-gate.mjs'
$negativeGateConfigPath = Join-Path $Root 'config/negative-regression-gate.json'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) {
    Add-Failure 'Negative-regression gate is blocked: Node.js is not available.'
} elseif ((Test-Path -LiteralPath $negativeGatePath -PathType Leaf) -and (Test-Path -LiteralPath $negativeGateConfigPath -PathType Leaf)) {
    try {
        $negativeGateOutput = & $nodeCommand.Source $negativeGatePath --config $negativeGateConfigPath --root $Root 2>&1
        $negativeGateExit = $LASTEXITCODE
        foreach ($line in $negativeGateOutput) { Write-Host "NEGATIVE-REGRESSION: $line" }
        if ($negativeGateExit -eq 1) {
            Add-Failure 'Negative-regression gate detected an active forbidden-regression violation.'
        } elseif ($negativeGateExit -eq 2) {
            Add-Failure 'Negative-regression gate is blocked or has an invalid registry/verifier contract.'
        } elseif ($negativeGateExit -ne 0) {
            Add-Failure "Negative-regression gate returned unsupported exit code: $negativeGateExit"
        }
    } catch {
        Add-Failure "Negative-regression gate execution failed: $($_.Exception.Message)"
    }
}

$baselinePath = Join-Path $Root 'config/project-baseline.yaml'
$baseline = if (Test-Path -LiteralPath $baselinePath) { Get-Content -Raw -LiteralPath $baselinePath } else { '' }
$requiredBaselineMarkers = @(
    'schema_version: ecc.device-cloud-control.baseline.v1',
    'active: safe-default',
    'default_bind_host: "127.0.0.1"',
    'capabilities: config/capabilities.yaml',
    'fallback_policy: config/fallback-policy.yaml',
    'skill_preflight: scripts/Invoke-SkillPreflight.ps1',
    'hermes_agent_preflight: scripts/Invoke-HermesResearchPreflight.ps1',
    'hermes_agent_role: .codex/agents/hermes-research-coordinator.toml',
    'web_clone_toolchain: config/web-clone-toolchain.yaml',
    'negative_regression_gate: scripts/ci/negative-regression-gate.mjs',
    'negative_decisions: config/negative-decisions.json',
    'required_readback: true'
)
foreach ($marker in $requiredBaselineMarkers) {
    if (-not $baseline.Contains($marker)) { Add-Failure "Baseline marker missing: $marker" }
}

if (-not $SkipHostAutomationSurface) {
    $codexConfigPath = Join-Path $Root '.codex/config.toml'
    $codexConfig = if (Test-Path -LiteralPath $codexConfigPath) { Get-Content -Raw -LiteralPath $codexConfigPath } else { '' }
    foreach ($marker in @('[mcp_servers.github]', '[mcp_servers.context7]', '[mcp_servers.exa]', '[mcp_servers.firecrawl]', '[mcp_servers.memory]', '[mcp_servers.playwright]', '[mcp_servers.sequential-thinking]', '[features]', 'multi_agent = true', 'multi_agent_v2 = true', '[agents.hermes_research_coordinator]', 'agents/hermes-research-coordinator.toml', 'sandbox_mode = "workspace-write"', 'Invoke-SkillPreflight.ps1', 'Invoke-HermesResearchPreflight.ps1')) {
        if (-not $codexConfig.Contains($marker)) { Add-Failure "Codex config marker missing: $marker" }
    }
}

$knowledgeGraphPath = Join-Path $Root 'config/knowledge-graph.yaml'
$knowledgeGraph = if (Test-Path -LiteralPath $knowledgeGraphPath) { Get-Content -Raw -LiteralPath $knowledgeGraphPath } else { '' }
foreach ($marker in @('package: graphifyy', 'default_mode: code-only', 'semantic_mode: opt-in', 'backend: ollama', 'model: qwen3:4b-no-think', 'token_budget: 3000', 'max_output_tokens: 1024', 'ollama_num_ctx: 8192', 'semantic_failure: code-only', 'local_only: true', 'graph_json: graphify-out/graph.json')) {
    if (-not $knowledgeGraph.Contains($marker)) { Add-Failure "Knowledge-graph marker missing: $marker" }
}

$skillRegistryPath = Join-Path $Root 'config/skill-registry.yaml'
$skillRegistry = if (Test-Path -LiteralPath $skillRegistryPath) { Get-Content -Raw -LiteralPath $skillRegistryPath } else { '' }
foreach ($marker in @('schema_version: ecc.device-cloud-control.skill-registry.v1', 'install_mode: explicit', 'optional_categories_default: exposed_via_installed_skills', 'project_skill_scope: .agents/skills', 'agent_exposure: all_project_agents', 'agent_visibility: project_discoverable', 'automatic_task_bootstrap: local_read_only', 'bootstrap_command: "pwsh -NoProfile -File .\\scripts\\Invoke-SkillPreflight.ps1"', 'skill_manifest_loading: all_project_metadata', 'activation_mode: automatic_task_matching', 'mandatory_task_router: ask-matt', 'mandatory_task_router_activation: every_task', 'mandatory_task_router_order: after_local_preflight_before_other_work', 'mandatory_agent_engineering_router: using-agent-skills', 'mandatory_agent_engineering_router_activation: every_task', 'mandatory_agent_engineering_router_order: after_ask_matt_before_other_work', 'agent_engineering_skill_source: mattpocock/skills', 'agent_engineering_skill_selection: task_matched', 'external_tool_activation: approval_gated', 'mutation_activation: explicit_approval', 'route_exposure: capability_route_only', 'lockfile: skills-lock.json', 'id: firecrawl', 'id: hermes-research-coordinator', 'kind: codex_v2_custom_agent_with_optional_loopback_adapter', 'status: registered_contract_only', 'role_config: .codex/agents/hermes-research-coordinator.toml', 'adapter_status: contract_only_not_live', 'a2a_enabled_by_default: false', 'max_parallel_children: 3', 'max_depth: 1', 'network_requests: false', 'external_mutations: false', 'id: mattpocock-skills', 'activation: mandatory_task_route', 'route: using-agent-skills', 'route_order: after_ask_matt_before_other_work', 'id: web-security-testing', 'id: cloud-device-control', 'id: cloud-phone-virtualization', 'id: telegram-control', 'status: exposed_via_installed_skills', 'implementation_status: route_only_not_runtime', 'auto_wrap_codex: false', 'auto_start_proxy: false')) {
    if (-not $skillRegistry.Contains($marker)) { Add-Failure "Skill-registry marker missing: $marker" }
}

$webToolchainPath = Join-Path $Root 'config/web-clone-toolchain.yaml'
$webToolchain = if (Test-Path -LiteralPath $webToolchainPath) { Get-Content -Raw -LiteralPath $webToolchainPath } else { '' }
foreach ($marker in @('schema_version: ecc.device-cloud-control.web-clone-toolchain.v1', 'copy_mode: clean_room_behavioral_reimplementation', 'exact_assets_or_code: prohibited_until_ownership_or_license_confirmed', 'bind_host: 127.0.0.1', 'api: msw', 'real_target_write_requests: false', 'required_before_target_replication: true')) {
    if (-not $webToolchain.Contains($marker)) { Add-Failure "Web-toolchain marker missing: $marker" }
}

$lockPath = Join-Path $Root 'skills-lock.json'
if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
    Add-Failure 'Missing skills-lock.json.'
} else {
    try {
        $lock = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json
        $lockSkillCount = @($lock.skills.psobject.Properties).Count
        if ($lock.version -ne 1 -or $lockSkillCount -lt 1) { Add-Failure 'skills-lock.json has no valid locked skills.' }
    } catch {
        Add-Failure 'Invalid skills-lock.json.'
    }
}

if (-not $SkipHostAutomationSurface) {
    $skillsPath = Join-Path $Root '.agents/skills'
    $installedSkillCount = if (Test-Path -LiteralPath $skillsPath -PathType Container) { @(Get-ChildItem -LiteralPath $skillsPath -Directory).Count } else { 0 }
    if ($installedSkillCount -lt 1) { Add-Failure 'No project-scoped skills found under .agents/skills.' }
    if ($lockSkillCount -gt 0 -and $installedSkillCount -ne $lockSkillCount) {
        Add-Failure "Project skill directory count ($installedSkillCount) does not match skills-lock.json ($lockSkillCount)."
    }

    $preflightPath = Join-Path $Root 'scripts/Invoke-SkillPreflight.ps1'
    if (Test-Path -LiteralPath $preflightPath -PathType Leaf) {
        try {
            $preflight = (& pwsh -NoProfile -File $preflightPath | ConvertFrom-Json)
            foreach ($field in @('status', 'summary', 'next_actions', 'artifacts')) {
                if ($null -eq $preflight.$field) { Add-Failure "Skill preflight response is missing field: $field" }
            }
            if ($preflight.status -ne 'success') { Add-Failure "Skill preflight did not pass: $($preflight.summary)" }
            if ($preflight.artifacts.network_requests -ne $false -or $preflight.artifacts.external_mutations -ne $false) {
                Add-Failure 'Skill preflight must remain local-only and mutation-free.'
            }
            if ($preflight.artifacts.mandatory_router.name -ne 'ask-matt' -or $preflight.artifacts.mandatory_router.activation -ne 'every_task' -or $preflight.artifacts.mandatory_router.ready -ne $true) {
                Add-Failure 'Skill preflight must report a ready ask-matt mandatory router.'
            }
            if ($preflight.artifacts.mandatory_agent_engineering_router.name -ne 'using-agent-skills' -or $preflight.artifacts.mandatory_agent_engineering_router.activation -ne 'every_task' -or $preflight.artifacts.mandatory_agent_engineering_router.source -ne 'mattpocock/skills' -or $preflight.artifacts.mandatory_agent_engineering_router.skill_count -lt 1 -or $preflight.artifacts.mandatory_agent_engineering_router.ready -ne $true) {
                Add-Failure 'Skill preflight must report a ready using-agent-skills engineering router with locked engineering skills.'
            }
        } catch {
            Add-Failure "Skill preflight execution failed: $($_.Exception.Message)"
        }
    }

    $hermesPreflightPath = Join-Path $Root 'scripts/Invoke-HermesResearchPreflight.ps1'
    if (Test-Path -LiteralPath $hermesPreflightPath -PathType Leaf) {
        try {
            $hermesPreflight = (& pwsh -NoProfile -File $hermesPreflightPath | ConvertFrom-Json)
            foreach ($field in @('status', 'summary', 'next_actions', 'artifacts')) {
                if ($null -eq $hermesPreflight.$field) { Add-Failure "Hermes preflight response is missing field: $field" }
            }
            if ($hermesPreflight.status -eq 'error') { Add-Failure "Hermes preflight did not pass: $($hermesPreflight.summary)" }
            if ($hermesPreflight.artifacts.external_mutations -ne $false -or $hermesPreflight.artifacts.mutation_applied -ne $false -or $hermesPreflight.artifacts.credentials_accessed -ne $false) {
                Add-Failure 'Hermes preflight must remain mutation-free and credential-free.'
            }
            if ($hermesPreflight.artifacts.adapter_status -notin @('contract_only_not_live', 'loopback_verified')) {
                Add-Failure "Hermes preflight returned an unknown adapter status: $($hermesPreflight.artifacts.adapter_status)"
            }
        } catch {
            Add-Failure "Hermes preflight execution failed: $($_.Exception.Message)"
        }
    }
}

$capabilityPath = Join-Path $Root 'config/capabilities.yaml'
$capabilities = if (Test-Path -LiteralPath $capabilityPath) { Get-Content -Raw -LiteralPath $capabilityPath } else { '' }
foreach ($marker in @('response_envelope:', 'required_fields: [status, summary, next_actions, artifacts]', 'skill_routes:', 'agent_routes:', 'exposure: all_project_agents', 'preflight: local_read_only', 'manifest_loading: all_project_metadata', 'activation: automatic_task_match', 'mandatory_task_router: ask-matt', 'mandatory_task_router_activation: every_task', 'mandatory_task_router_order: after_local_preflight_before_other_work', 'mandatory_agent_engineering_router: using-agent-skills', 'mandatory_agent_engineering_router_activation: every_task', 'mandatory_agent_engineering_router_order: after_ask_matt_before_other_work', 'agent_engineering_skill_source: mattpocock/skills', 'agent_engineering_skill_selection: task_matched', 'external_tool_activation: approval_gated', 'mutation_activation: explicit_approval', 'implementation_status: route_only_not_runtime', 'id: web-repository-acquisition', 'id: web-security-testing', 'id: cloud-device-control', 'id: cloud-phone-virtualization', 'id: telegram-control', 'id: hermes-research-coordinator', 'role: hermes_research_coordinator', 'adapter_status: contract_only_not_live', 'adapter_preflight: scripts/Invoke-HermesResearchPreflight.ps1', 'max_parallel_children: 3', 'max_depth: 1', 'id: get_health', 'id: coordinate_hermes_research', 'fixed_response_envelope: required', 'id: execute_device_operation', 'id: rollback_snapshot')) {
    if (-not $capabilities.Contains($marker)) { Add-Failure "Capability marker missing: $marker" }
}

$fallbackPath = Join-Path $Root 'config/fallback-policy.yaml'
$fallback = if (Test-Path -LiteralPath $fallbackPath) { Get-Content -Raw -LiteralPath $fallbackPath } else { '' }
foreach ($marker in @('default_policy: safe-stop', 'no_hidden_llm_retry: true', 'stop_condition:', 'recovery:', 'audit_event:', 'id: unknown-error')) {
    if (-not $fallback.Contains($marker)) { Add-Failure "Fallback marker missing: $marker" }
}

$safeProfilePath = Join-Path $Root 'config/profiles/safe-default.yaml'
$safeProfile = if (Test-Path -LiteralPath $safeProfilePath) { Get-Content -Raw -LiteralPath $safeProfilePath } else { '' }
foreach ($marker in @('bind_host: 127.0.0.1', 'allow_remote: false', 'dry_run_default: true', 'require_readback_for_mutation: true', 'unknown_error: safe_stop')) {
    if (-not $safeProfile.Contains($marker)) { Add-Failure "Safe profile marker missing: $marker" }
}

$graphFiles = Get-ChildItem -LiteralPath (Join-Path $Root 'graphs') -Filter '*.mmd' -File -ErrorAction SilentlyContinue
if ($null -eq $graphFiles -or $graphFiles.Count -lt 5) {
    Add-Failure 'Expected at least five Mermaid graph files.'
} else {
    foreach ($graph in $graphFiles) {
        $content = Get-Content -Raw -LiteralPath $graph.FullName
        if ($content -notmatch '(?m)^(flowchart|stateDiagram-v2)') {
            Add-Failure "Graph does not declare a supported Mermaid diagram: $($graph.Name)"
        }
    }
}

$schemaFiles = Get-ChildItem -LiteralPath (Join-Path $Root 'schemas') -Filter '*.json' -File -ErrorAction SilentlyContinue
foreach ($schema in $schemaFiles) {
    try {
        Get-Content -Raw -LiteralPath $schema.FullName | ConvertFrom-Json | Out-Null
    } catch {
        Add-Failure "Invalid JSON schema: $($schema.Name)"
    }
}

$sensitivePattern = '(?i)(-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|password\s*[:=]\s*["'']?[^$<{\r\n]{8,}|token\s*[:=]\s*["'']?[A-Za-z0-9_\-]{20,})'
$scanExtensions = @('*.md', '*.yaml', '*.yml', '*.json', '*.ps1', '*.env')
$filesToScan = foreach ($extension in $scanExtensions) {
    Get-ChildItem -LiteralPath $Root -Recurse -File -Filter $extension -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\(\.git|node_modules|runtime\\(state|cache|logs|snapshots))\\' }
}
foreach ($file in ($filesToScan | Sort-Object -Property FullName -Unique)) {
    $content = Get-Content -Raw -LiteralPath $file.FullName
    $relative = $file.FullName.Substring($Root.Length).TrimStart('\')
    $isThirdPartySkill = $relative -like '.agents\skills\*'
    # Third-party skills contain documented placeholder examples such as
    # "mypassword" and "ghp_your_github_token". Keep high-confidence scans
    # for those sources while applying the broader heuristic to project files.
    $matchedSensitivePattern = if ($isThirdPartySkill) {
        $content -match '(?i)(-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16})'
    } else {
        $content -match $sensitivePattern
    }
    if ($matchedSensitivePattern -and $relative -ne '.env.example' -and $content -notmatch 'external_secret_store|Do not put real credentials|PLACEHOLDER') {
        Add-Failure "Possible credential-like value found in: $relative"
    }
}

if ($failures.Count -gt 0) {
    Write-Host 'BASELINE VERIFICATION: FAIL' -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "- $_" }
    exit 1
}

Write-Host 'BASELINE VERIFICATION: PASS' -ForegroundColor Green
Write-Host "Files checked: $($requiredFiles.Count) required files plus graph, schema, and secret scans"
Write-Host "Host automation surface: $(if ($SkipHostAutomationSurface) { 'skipped for CI' } else { 'verified' })"
Write-Host 'Active profile: safe-default'
Write-Host 'External connectors: placeholders only'
