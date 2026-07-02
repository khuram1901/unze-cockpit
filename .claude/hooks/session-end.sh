#!/bin/bash

# Session end hook — runs when a Claude Code session closes.
# Does three things:
# 1. Saves the session transcript
# 2. Invokes the session-summarizer to create a 1-page summary
# 3. Invokes the blueprint-keeper to update BLUEPRINT.md and CHANGELOG.md

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"

SESSIONS_DIR="$PROJECT_ROOT/sessions"
SUMMARIES_DIR="$SESSIONS_DIR/summaries"
mkdir -p "$SESSIONS_DIR"
mkdir -p "$SUMMARIES_DIR"

TIMESTAMP=$(date +%Y-%m-%d_%H%M)
TRANSCRIPT_FILE="$SESSIONS_DIR/session_${TIMESTAMP}.md"

# ─────────────────────────────────────────────────
# Step 1 — Save the transcript
# ─────────────────────────────────────────────────
if [ -n "$CLAUDE_SESSION_LOG" ] && [ -f "$CLAUDE_SESSION_LOG" ]; then
    cp "$CLAUDE_SESSION_LOG" "$TRANSCRIPT_FILE"
    echo "📝 Session transcript saved: $TRANSCRIPT_FILE"
else
    cat > "$TRANSCRIPT_FILE" <<EOF
# Session — $TIMESTAMP

Started: $(date)
Working directory: $PROJECT_ROOT
Git branch: $(git branch --show-current 2>/dev/null || echo "unknown")
Last commit: $(git log -1 --oneline 2>/dev/null || echo "unknown")

_Session transcript not automatically captured. Add manually if needed._
EOF
fi

# ─────────────────────────────────────────────────
# Step 2 — Create a 1-page summary
# ─────────────────────────────────────────────────
echo "📋 Creating session summary..."
claude --agent session-summarizer --print "Session just ended. Summarize the transcript at $TRANSCRIPT_FILE." 2>&1 || {
    echo "⚠️  Summary creation failed. Run '/agents session-summarizer' manually next time."
}

# ─────────────────────────────────────────────────
# Step 3 — Update the blueprint
# ─────────────────────────────────────────────────
echo "🔄 Updating blueprint..."
claude --agent blueprint-keeper --print "Session ended. Update BLUEPRINT.md and CHANGELOG.md to reflect the current state of the codebase. Commit and push both files." 2>&1 || {
    echo "⚠️  Blueprint update failed. Run '/agents blueprint-keeper' manually next time."
    exit 0
}

echo "✅ Session end hook complete."
echo "   Transcript: $TRANSCRIPT_FILE"
echo "   Summary:    $SUMMARIES_DIR/summary_${TIMESTAMP}.md"
echo "   Blueprint:  updated"
