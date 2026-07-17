#!/bin/bash

# Daily blueprint update — runs at 6pm every day via macOS launchd.
# Only runs if the Mac is awake. Uses launchd's "if missed, run when possible" behaviour.

set -e

PROJECT_ROOT="/Users/jamesbond/Documents/App/Unze Dashboard"

# Make sure the project exists (safeguard for both Macs)
if [ ! -d "$PROJECT_ROOT" ]; then
    PROJECT_ROOT="/Users/jamesbond/Documents/App/Unze Dashboard"
fi
if [ ! -d "$PROJECT_ROOT" ]; then
    echo "❌ Cannot find unze-cockpit project folder. Edit this script to set the correct path."
    exit 1
fi

cd "$PROJECT_ROOT"

# Log everything to a file for troubleshooting
LOG_FILE="$PROJECT_ROOT/.blueprint-daily.log"
exec >> "$LOG_FILE" 2>&1

echo ""
echo "─────────────────────────────────────────────────────────"
echo "Daily blueprint run — $(date)"
echo "─────────────────────────────────────────────────────────"

# Pull latest from GitHub first so we're up to date
git pull --rebase origin main 2>&1 || echo "⚠️  git pull failed — continuing anyway"

# Invoke the blueprint-keeper sub-agent
claude --agent blueprint-keeper --print "Daily scheduled run. Do a comprehensive blueprint refresh. Update BLUEPRINT.md and append to CHANGELOG.md. Commit and push."

echo "✅ Daily run finished — $(date)"
