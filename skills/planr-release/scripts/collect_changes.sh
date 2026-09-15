#!/usr/bin/env bash
# Collect everything that shipped in a window, as raw material for release notes.
#
# Usage:
#   ./collect_changes.sh                         # since the last tag
#   ./collect_changes.sh "2026-09-01"            # since a date
#   ./collect_changes.sh --include-prs            # include remote PR metadata
#   ./collect_changes.sh "2026-09-01" --include-prs
#
# Output is raw material, not release notes. Classify it before writing.

set -uo pipefail

SINCE_ARG=""
INCLUDE_PRS=0

for ARG in "$@"; do
  case "$ARG" in
    --include-prs)
      INCLUDE_PRS=1
      ;;
    -*)
      printf 'Unknown option: %s\n' "$ARG" >&2
      exit 2
      ;;
    *)
      if [ -n "$SINCE_ARG" ]; then
        printf 'Only one date window may be supplied.\n' >&2
        exit 2
      fi
      SINCE_ARG="$ARG"
      ;;
  esac
done

if [ -n "$SINCE_ARG" ]; then
  RANGE_DESC="since $SINCE_ARG"
  LOG_ARGS=(--since="$SINCE_ARG")
  PR_SEARCH="merged:>=$SINCE_ARG"
else
  LAST_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"
  if [ -z "$LAST_TAG" ]; then
    RANGE_DESC="all history (no previous tag found)"
    LOG_ARGS=()
    PR_SEARCH=""
  else
    TAG_DATE="$(git log -1 --format=%cs "$LAST_TAG")"
    RANGE_DESC="since $LAST_TAG ($TAG_DATE)"
    LOG_ARGS=("$LAST_TAG..HEAD")
    PR_SEARCH="merged:>=$TAG_DATE"
  fi
fi

echo "=============================================="
echo "Changes $RANGE_DESC"
echo "=============================================="
echo
echo "--- Recent tags (match this format when tagging) ---"
git tag --list --sort=-creatordate | head -5 || echo "none"
echo
echo "--- Commits (merges excluded) ---"
git log "${LOG_ARGS[@]}" --no-merges --pretty=format:'%h %s' || true
echo
echo
echo "--- Files touched, by area ---"
git log "${LOG_ARGS[@]}" --name-only --pretty=format: 2>/dev/null \
  | awk 'NF' \
  | awk -F/ '{ if (NF>1) print $1"/"$2; else print $1 }' \
  | sort | uniq -c | sort -rn | head -20
echo
echo "--- Merged PRs ---"
if [ "$INCLUDE_PRS" -eq 1 ] && command -v gh >/dev/null 2>&1 && [ -n "$PR_SEARCH" ]; then
  gh pr list --state merged --search "$PR_SEARCH" --limit 100 \
    --json number,title \
    --template '{{range .}}#{{.number}} {{.title}}{{"\n"}}{{end}}' 2>/dev/null \
    || echo "gh is installed but the query failed. Check: gh auth status"
else
  echo "PR collection not requested, unavailable, or missing a date window."
fi
echo
echo "=============================================="
echo "Check whether this misses config or feature flag"
echo "changes, infrastructure, work from other repos,"
echo "or other user-visible behavior before finalizing."
echo "=============================================="
