#!/usr/bin/env bash
# Start a new scratch ask: ./scratch/new.sh "csv import spike"
#
# Creates scratch/<YYYY-MM-DD>-<slug>/README.md from _template.md and prints the
# path. Refuses to clobber an existing directory.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ $# -eq 0 ]; then
  echo "usage: $(basename "$0") \"short description of the ask\"" >&2
  exit 64
fi

title="$*"
date="$(date +%F)"

# Lowercase, non-alphanumerics to hyphens, collapse and trim runs of hyphens.
slug="$(printf '%s' "$title" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -e 's/[^a-z0-9]\{1,\}/-/g' -e 's/^-//' -e 's/-$//')"

if [ -z "$slug" ]; then
  echo "error: description produced an empty slug" >&2
  exit 64
fi

dir="$here/$date-$slug"

if [ -e "$dir" ]; then
  echo "error: $dir already exists" >&2
  exit 1
fi

mkdir -p "$dir"
# Fill the template by splitting on each placeholder. Neither sed nor
# ${var//pat/repl} is safe here: the title is arbitrary text, and sed would need
# / escaped while bash 5.2+ reads a bare & in a replacement as "the matched
# text" (so "a & b" comes out as "a <ask> b"). Prefix/suffix trimming has no
# such quoting rules. Substitute <date> first so a title can't shadow it.
template="$(cat "$here/_template.md")"
template="${template%%<date>*}$date${template#*<date>}"
template="${template%%<ask>*}$title${template#*<ask>}"
printf '%s\n' "$template" > "$dir/README.md"

echo "$dir/README.md"
