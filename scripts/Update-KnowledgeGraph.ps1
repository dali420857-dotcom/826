[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$NoCluster,
    [switch]$Semantic
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$graphify = Get-Command graphify -ErrorAction SilentlyContinue
if ($null -eq $graphify) {
    throw 'graphify CLI is not available. Install it with: uv tool install graphifyy'
}

# Keep the local Ollama request inside the machine's available memory. These
# are process-scoped overrides; no credential or persistent user setting is
# written.
$env:GRAPHIFY_MAX_OUTPUT_TOKENS = '1024'
$env:GRAPHIFY_OLLAMA_NUM_CTX = '8192'
$env:GRAPHIFY_OLLAMA_KEEP_ALIVE = '5m'

$arguments = @(
    'extract',
    $root,
    '--out', $root,
    '--max-workers', '4'
)

if ($Semantic) {
    $arguments += @(
        '--backend', 'ollama',
        '--model', 'qwen3:4b-no-think',
        '--token-budget', '3000',
        '--api-timeout', '600',
        '--max-concurrency', '1'
    )
} else {
    $arguments += '--code-only'
}
if ($Force) { $arguments += '--force' }
if ($NoCluster) { $arguments += '--no-cluster' }

if ($Semantic) {
    Write-Host 'Building project knowledge graph with local Ollama (no cloud backend).' -ForegroundColor Cyan
} else {
    Write-Host 'Building deterministic local AST knowledge graph (no model or network).' -ForegroundColor Cyan
}
& $graphify.Source @arguments
if ($LASTEXITCODE -ne 0 -and $Semantic) {
    Write-Warning 'Semantic extraction failed; falling back to deterministic code-only graph.'
    $fallbackArguments = @('extract', $root, '--out', $root, '--code-only', '--force', '--max-workers', '4')
    if ($NoCluster) { $fallbackArguments += '--no-cluster' }
    & $graphify.Source @fallbackArguments
}
if ($LASTEXITCODE -ne 0) {
    throw "graphify extract failed with exit code $LASTEXITCODE"
}

if (-not $NoCluster) {
    Write-Host 'Generating deterministic communities, report, and HTML view.' -ForegroundColor Cyan
    & $graphify.Source 'cluster-only' $root '--no-label'
    if ($LASTEXITCODE -ne 0) {
        throw "graphify cluster-only failed with exit code $LASTEXITCODE"
    }
}

$output = Join-Path $root 'graphify-out'
$required = if ($NoCluster) { @('graph.json') } else { @('graph.json', 'GRAPH_REPORT.md', 'graph.html') }
$missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $output $_) -PathType Leaf) })
if ($missing.Count -gt 0) {
    throw "Graphify completed without required artifacts: $($missing -join ', ')"
}

$graphSize = (Get-Item -LiteralPath (Join-Path $output 'graph.json')).Length
Write-Host "Knowledge graph ready: $output" -ForegroundColor Green
Write-Host "graph.json bytes: $graphSize"
if ($Semantic) {
    Write-Host 'Semantic mode was requested; inspect Graphify output for semantic cache status.'
} else {
    Write-Host 'Default mode is deterministic code-only. Use -Semantic to opt into local Ollama document extraction.'
}
Write-Host 'Use graphify query, graphify path, graphify explain, or graphify god-nodes to inspect it.'
