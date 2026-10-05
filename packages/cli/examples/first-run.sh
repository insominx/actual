#!/usr/bin/env bash
# First run with the Actual CLI from bash: create a local budget with
# accounts, import a CSV, add a transaction from stdin JSON, and back up.
# Paths may contain spaces; every expansion is quoted.
#
# Usage: first-run.sh "<work directory>"
# Credentials come from the environment (ACTUAL_SERVER_URL, ACTUAL_PASSWORD)
# or a profile, never from arguments in this script.
set -euo pipefail

work="${1:?usage: first-run.sh <work directory>}"
mkdir -p "$work"

# ACTUAL_CLI_JS lets tests run an unpublished build; normally `actual` is on PATH.
actual() {
  if [ -n "${ACTUAL_CLI_JS:-}" ]; then
    node "$ACTUAL_CLI_JS" --output-version 2 "$@"
  else
    command actual --output-version 2 "$@"
  fi
}

# JSON values come from jq-free node one-liners so the script only needs Node.
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v=JSON.parse(s);for(const k of process.argv[1].split("."))v=v[k];process.stdout.write(String(v))})' "$1"; }

spec=$(cat <<'JSON'
{"budgetName":"Tutorial budget","accounts":[{"name":"Checking","offbudget":false,"initialBalance":250000}],"categoryGroups":[{"name":"Everyday","categories":["Groceries"]}]}
JSON
)
setup=$(actual --offline workflow setup --spec "$spec")
budget=$(printf '%s' "$setup" | field data.budget.budgetId)
checking=$(printf '%s' "$setup" | field data.steps.1.result.id)
local_budget=(--offline --budget-id "$budget")

cat > "$work/bank export.csv" <<'CSV'
Date,Payee,Amount
2026-09-02,Corner Grocer,-23.45
2026-09-03,"Smith, Jones & Co",-10.00
CSV
cat > "$work/intake manifest.json" <<JSON
[{"file":"bank export.csv","account":"$checking","settings":{"fields":{"date":"Date","payee":"Payee","amount":"Amount"},"dateFormat":"yyyy mm dd"}}]
JSON
actual "${local_budget[@]}" workflow intake "$work/intake manifest.json" > "$work/intake result.json"

# Stdin JSON: quotes and apostrophes survive because nothing is re-parsed by the shell.
printf '%s' '[{"date":"2026-09-04","amount":-1999,"payee_name":"O'"'"'Brien \"Books\""}]' |
  actual "${local_budget[@]}" transactions add --account "$checking" --file - > "$work/added.json"

mkdir -p "$work/backups"
actual "${local_budget[@]}" backups create --directory "$work/backups" > "$work/backup.json"
printf '%s\n' "$budget"
