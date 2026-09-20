param(
    [string]$Server = 'root@103.27.132.88',
    [string]$Ref = 'origin/main',
    [switch]$SkipFetch
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
function Check-Exit([string]$Action) { if ($LASTEXITCODE -ne 0) { throw "$Action failed ($LASTEXITCODE)" } }
Push-Location $repoRoot
try {
    if (-not $SkipFetch) { git fetch origin main; Check-Exit 'Fetch main' }
    $revision = (git rev-parse --verify "${Ref}^{commit}").Trim()
    Check-Exit 'Resolve committed source'
    if ($revision -notmatch '^[0-9a-f]{40}$') { throw 'Expected full commit SHA' }
    git merge-base --is-ancestor $revision origin/main
    Check-Exit 'Verify commit is published on main'
    $taskDirectory = Join-Path ([IO.Path]::GetTempPath()) ('grp6-preview-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $taskDirectory | Out-Null
    $archive = Join-Path $taskDirectory "$revision.tar.gz"
    git archive --format=tar.gz --output=$archive $revision frontend results/replay/replay.jsonl results/replay/predictions.jsonl results/replay/predictions.provenance.json deploy/vps-preview/verify-http.mjs
    Check-Exit 'Create committed archive'
    $checksum = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    scp -o BatchMode=yes -o ConnectTimeout=15 $archive "${Server}:/opt/grp6-preview/incoming/"
    Check-Exit 'Upload archive'
    ssh -o BatchMode=yes -o ConnectTimeout=15 $Server "/opt/grp6-preview/bin/update-release /opt/grp6-preview/incoming/$revision.tar.gz $revision $checksum"
    Check-Exit 'Build and activate preview'
    Write-Output "Preview revision: $revision. The VPS updater reports its configured nginx upstream."
} finally { Pop-Location }
