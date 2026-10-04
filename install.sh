#!/usr/bin/env bash
#
# Install (or reinstall) Creel into your VS Code extensions folder, and build
# the skill list there.
#
# Generation deliberately happens in the INSTALLED copy, never in the repo, so
# your personal skill list cannot leak into a commit or a published package.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

read_field() {
	node -p "require('$here/package.json').$1"
}

name="$(read_field publisher).$(read_field name)-$(read_field version)"
dest="$HOME/.vscode/extensions/$name"

# Remove any previously installed version first: two copies would register the
# same tool ids and collide. The second glob clears installs from before the
# rename to Creel, which would otherwise sit there shadowing this one.
rm -rf "$HOME/.vscode/extensions/$(read_field publisher).creel-"* 2>/dev/null || true
rm -rf "$HOME/.vscode/extensions/$(read_field publisher).nkana-"* 2>/dev/null || true

rm -rf "$dest"
mkdir -p "$dest"

# Copy in only what a packaged build would carry. A plain `cp` ignores
# .vscodeignore — that file is read by `vsce package`, not by us — which is how
# a stale .vsix and a pre-rename skills.json ended up inside the installed
# extension. rsync understands the same patterns, so reuse the ignore file as
# the one source of truth for what ships.
if command -v rsync >/dev/null 2>&1; then
	rsync -a --prune-empty-dirs --exclude-from="$here/.vscodeignore" "$here"/ "$dest"/
else
	cp -r "$here"/. "$dest"/
	rm -f "$dest"/*.vsix "$dest"/skills.json
fi

rm -rf "$dest/.git" "$dest/node_modules" "$dest/.github"

node "$dest/generate.js"

echo
echo "Installed to $dest"
echo "Now run 'Developer: Reload Window', then type # in chat."
