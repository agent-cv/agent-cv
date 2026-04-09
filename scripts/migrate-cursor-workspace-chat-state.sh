#!/usr/bin/env bash
# Migrates Cursor workspace chat/composer SQLite state when a repo moves on disk.
# Chat UI data lives in: ~/Library/Application Support/Cursor/User/workspaceStorage/<id>/state.vscdb
# (NOT in ~/.cursor/projects/ — that is mostly agent worker logs + agent-transcripts.)
#
# Usage:
#   1. Quit Cursor completely (Cmd+Q).
#   2. Run as your user — do NOT use sudo (~/Library is yours; sudo breaks paths and ownership).
#      bash scripts/migrate-cursor-workspace-chat-state.sh
#      DRY_RUN=1 bash scripts/migrate-cursor-workspace-chat-state.sh
#
# Optional env:
#   DRY_RUN=1  — only print what would be copied
#
# Compatible with macOS /bin/bash 3.2 (no mapfile / readarray).

set -euo pipefail

WS_ROOT="${HOME}/Library/Application Support/Cursor/User/workspaceStorage"

die() { echo "ERROR: $*" >&2; exit 1; }

[[ -d "$WS_ROOT" ]] || die "Missing: $WS_ROOT"

find_ws_dir_for_path() {
  local needle="$1"
  local encoded="${needle//\//%2F}"
  local d meta
  while IFS= read -r -d '' meta; do
    d="$(dirname "$meta")"
    if grep -qF "$needle" "$meta" 2>/dev/null || grep -qF "$encoded" "$meta" 2>/dev/null; then
      printf '%s\n' "$d"
    fi
  done < <(find "$WS_ROOT" -maxdepth 2 -name workspace.json -print0 2>/dev/null)
}

copy_state() {
  local label="$1"
  local old_needle="$2"
  local new_needle="$3"
  local line
  local -a OLD_DIRS NEW_DIRS

  OLD_DIRS=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && OLD_DIRS+=("$line")
  done < <(find_ws_dir_for_path "$old_needle")

  NEW_DIRS=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && NEW_DIRS+=("$line")
  done < <(find_ws_dir_for_path "$new_needle")

  if [[ ${#OLD_DIRS[@]} -eq 0 ]]; then
    echo "[$label] No workspaceStorage entry found for OLD path containing: $old_needle"
    return 0
  fi
  if [[ ${#OLD_DIRS[@]} -gt 1 ]]; then
    echo "[$label] Multiple OLD matches; using first:"
    printf '  %s\n' "${OLD_DIRS[@]}"
  fi
  if [[ ${#NEW_DIRS[@]} -eq 0 ]]; then
    echo "[$label] No workspaceStorage entry for NEW path containing: $new_needle"
    echo "  Open the project once in Cursor from the new path, quit Cursor, then re-run this script."
    return 0
  fi
  if [[ ${#NEW_DIRS[@]} -gt 1 ]]; then
    echo "[$label] Multiple NEW matches; using first:"
    printf '  %s\n' "${NEW_DIRS[@]}"
  fi

  local old_dir="${OLD_DIRS[0]}"
  local new_dir="${NEW_DIRS[0]}"
  local src="${old_dir}/state.vscdb"
  local dst="${new_dir}/state.vscdb"

  echo "[$label]"
  echo "  OLD: $old_dir"
  echo "  NEW: $new_dir"

  [[ -f "$src" ]] || { echo "  skip: missing $src"; return 0; }

  if [[ -n "${DRY_RUN:-}" ]]; then
    echo "  dry-run: would copy -> $dst"
    return 0
  fi

  if [[ -f "$dst" ]]; then
    local bak="${dst}.bak.$(date +%Y%m%d%H%M%S)"
    cp -p "$dst" "$bak"
    echo "  backed up existing: $bak"
  fi

  cp -p "$src" "$dst"
  echo "  copied state.vscdb OK"
}

echo "Cursor workspaceStorage: $WS_ROOT"
echo ""

# Adjust needles if your paths differ.
copy_state "agent-cv (CLI)" \
  "Projects/orgs/beautyfree/llm-cv" \
  "Projects/orgs/agent-cv/agent-cv"

copy_state "agent-cv-web" \
  "Projects/orgs/beautyfree/agent-cv-web" \
  "Projects/orgs/agent-cv/agent-cv-web"

echo ""
echo "Done. Start Cursor and open the repo from the new path."
