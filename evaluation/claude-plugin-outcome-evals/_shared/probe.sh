# Sourced last by every case scaffold. Records what the run environment exposes
# to .git/info/eval-probe.json, which stays out of the working tree and the diff.
# The output holds neutral keys, booleans and counts only: the workspace must not
# name the product, and no absolute path or variable value is written.
# EVAL_HIDDEN_DIR and EVAL_GRADERS_DIR, when set, name folders the agent must not
# read; each gets a readability field, omitted when its variable is unset.
# gitWorks records whether git runs at all in this environment.
# shellcheck shell=bash

# Prints true when the folder lists and its first regular file reads, else false.
eval_probe_readable() {
  local file
  ls -A "$1" >/dev/null 2>&1 || { printf false; return; }
  file=$(find "$1" -maxdepth 1 -type f 2>/dev/null | sort | head -n 1 || true)
  if [ -z "$file" ] || head -c 1 "$file" >/dev/null 2>&1; then printf true; else printf false; fi
}

eval_probe() {
  local cli=false claude_dir=false claude_plugins=false claude_md=false git_works=false entries readable=''
  if command -v openplanr >/dev/null 2>&1 || command -v planr >/dev/null 2>&1; then cli=true; fi
  [ -d "$HOME/.claude" ] && claude_dir=true
  [ -d "$HOME/.claude/plugins" ] && claude_plugins=true
  [ -f "$HOME/.claude/CLAUDE.md" ] && claude_md=true
  git --version >/dev/null 2>&1 && git_works=true
  entries=$(printf '%s' "$PATH" | tr ':' '\n' | grep -c . || true)
  if [ -n "${EVAL_HIDDEN_DIR:-}" ]; then
    readable+=",\"hiddenReadable\":$(eval_probe_readable "$EVAL_HIDDEN_DIR")"
  fi
  if [ -n "${EVAL_GRADERS_DIR:-}" ]; then
    readable+=",\"gradersReadable\":$(eval_probe_readable "$EVAL_GRADERS_DIR")"
  fi
  mkdir -p .git/info
  printf '{"schema":1,"stage":"scaffold","productCliOnPath":%s,"home":{"claudeDir":%s,"claudePlugins":%s,"claudeMd":%s},"gitWorks":%s,"pathEntries":%s%s}\n' \
    "$cli" "$claude_dir" "$claude_plugins" "$claude_md" "$git_works" "$entries" "$readable" > .git/info/eval-probe.json
}

eval_probe
