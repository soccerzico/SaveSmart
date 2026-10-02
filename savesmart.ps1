# SaveSmart CLI.  Usage: savesmart launch [backend|frontend]   (omit for both)
$root = $PSScriptRoot
$venvPython = Join-Path $root 'backend\venv\Scripts\python.exe'
$python = if (Test-Path $venvPython) { $venvPython } else { 'python' }

$command = $args[0]
$rest = @($args | Select-Object -Skip 1)
switch ($command) {
    'launch' { & $python (Join-Path $root 'dev.py') @rest; exit $LASTEXITCODE }
    default {
        Write-Host 'Usage: savesmart launch [backend|frontend]   (omit for both)'
        exit $(if ($command) { 1 } else { 0 })
    }
}
