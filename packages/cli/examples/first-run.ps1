# First run with the Actual CLI from PowerShell: create a local budget with
# accounts, import a CSV, add a transaction from stdin JSON, and back up.
# Paths may contain spaces; pass them as single arguments.
#
# Usage: ./first-run.ps1 -Work "C:\Users\me\Actual tutorial"
# Credentials come from the environment ($env:ACTUAL_SERVER_URL,
# $env:ACTUAL_PASSWORD) or a profile, never from arguments in this script.
param([Parameter(Mandatory = $true)][string]$Work)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Work | Out-Null

function Invoke-Actual {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  if ($env:ACTUAL_CLI_JS) {
    $output = & node $env:ACTUAL_CLI_JS --output-version 2 @Arguments
  } else {
    $output = & actual --output-version 2 @Arguments
  }
  if ($LASTEXITCODE -ne 0) { throw "actual failed ($LASTEXITCODE): $output" }
  return ($output -join "`n") | ConvertFrom-Json
}

# JSON arguments need PowerShell 7.3 or later, which passes embedded double
# quotes to native commands unchanged; Windows PowerShell 5.1 strips them.
$PSNativeCommandArgumentPassing = 'Standard'
$spec = @{
  budgetName = 'Tutorial budget'
  accounts = @(@{ name = 'Checking'; offbudget = $false; initialBalance = 250000 })
  categoryGroups = @(@{ name = 'Everyday'; categories = @('Groceries') })
} | ConvertTo-Json -Depth 5 -Compress
$specFile = Join-Path $Work 'setup spec.json'
Set-Content -LiteralPath $specFile -Value $spec -Encoding utf8
$setup = Invoke-Actual --offline workflow setup --spec (Get-Content -Raw -LiteralPath $specFile)
$budget = $setup.data.budget.budgetId
$checking = $setup.data.steps[1].result.id
$local = @('--offline', '--budget-id', $budget)

Set-Content -LiteralPath (Join-Path $Work 'bank export.csv') -Encoding utf8 -Value @'
Date,Payee,Amount
2026-09-02,Corner Grocer,-23.45
2026-09-03,"Smith, Jones & Co",-10.00
'@
$manifest = @(@{
  file = 'bank export.csv'; account = $checking
  settings = @{ fields = @{ date = 'Date'; payee = 'Payee'; amount = 'Amount' }; dateFormat = 'yyyy mm dd' }
}) | ConvertTo-Json -Depth 6 -Compress
$manifestFile = Join-Path $Work 'intake manifest.json'
Set-Content -LiteralPath $manifestFile -Value "[$($manifest.TrimStart('[').TrimEnd(']'))]" -Encoding utf8
Invoke-Actual @local workflow intake $manifestFile | Out-Null

$rows = '[{"date":"2026-09-04","amount":-1999,"payee_name":"O''Brien \"Books\""}]'
if ($env:ACTUAL_CLI_JS) {
  $rows | & node $env:ACTUAL_CLI_JS --output-version 2 @local transactions add --account $checking --file - | Out-Null
} else {
  $rows | & actual --output-version 2 @local transactions add --account $checking --file - | Out-Null
}

$backups = Join-Path $Work 'backups'
New-Item -ItemType Directory -Force -Path $backups | Out-Null
Invoke-Actual @local backups create --directory $backups | Out-Null
Write-Output $budget
