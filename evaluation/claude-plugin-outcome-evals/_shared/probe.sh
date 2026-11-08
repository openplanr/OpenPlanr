# Sourced last by every case scaffold. Records what the run environment exposes
# to .git/info/eval-probe.json, which stays out of the working tree and the diff.
# The output holds neutral keys, booleans and counts only: the workspace must not
# name the product, and no absolute path or variable value is written.
# shellcheck shell=bash

eval_probe() {
  local cli=false claude_dir=false claude_plugins=false claude_md=false entries
  if command -v openplanr >/dev/null 2>&1 || command -v planr >/dev/null 2>&1; then cli=true; fi
  [ -d "$HOME/.claude" ] && claude_dir=true
  [ -d "$HOME/.claude/plugins" ] && claude_plugins=true
  [ -f "$HOME/.claude/CLAUDE.md" ] && claude_md=true
  entries=$(printf '%s' "$PATH" | tr ':' '\n' | grep -c . || true)
  mkdir -p .git/info
  printf '{"schema":1,"stage":"scaffold","productCliOnPath":%s,"home":{"claudeDir":%s,"claudePlugins":%s,"claudeMd":%s},"pathEntries":%s}\n' \
    "$cli" "$claude_dir" "$claude_plugins" "$claude_md" "$entries" > .git/info/eval-probe.json
}

eval_probe
