#!/usr/bin/env bash
#
# Install (or reinstall) Nkana into your VS Code extensions folder, and build
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
# same tool ids and collide.
rm -rf "$HOME/.vscode/extensions/$(read_field publisher).nkana-"* 2>/dev/null || true

rm -rf "$dest"
mkdir -p "$dest"
cp -r "$here"/. "$dest"/
rm -rf "$dest/.git" "$dest/node_modules" "$dest/.github"

node "$dest/generate.js"

echo
echo "Installed to $dest"
echo "Now run 'Developer: Reload Window', then type # in chat."
