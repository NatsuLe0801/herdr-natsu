#!/bin/sh
# One-command installer for herdr-natsu: clones/updates this repo into Herdr's
# mods folder, symlinks every mod, installs the natsu layout + keys, and sets
# up the three MCP servers (natsu-hc, natsu-browser, agent-desktop).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/NatsuLe0801/herdr-natsu/main/install.sh | sh
# or, from a clone you already have:
#   sh install.sh
#
# Requires on PATH: git, node/npm, claude (Claude Code CLI). Safe to re-run.

set -e

REPO_URL="https://github.com/NatsuLe0801/herdr-natsu.git"
HERDR_HOME="${HERDR_HOME:-$HOME/.config/herdr-app}"
REPO_DIR="$HERDR_HOME/mods/herdr-natsu"
MODS="natsu-folders natsu-settings natsu-browser-view natsu-status natsu-tabs natsu-agents"

echo "==> Repo"
mkdir -p "$HERDR_HOME/mods"
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$REPO_DIR"
fi

echo "==> Linking mods"
for mod in $MODS; do
  ln -sfn "$REPO_DIR/mods/$mod" "$HERDR_HOME/mods/$mod"
done

echo "==> Layout + keys"
mkdir -p "$HERDR_HOME/layouts"
cp -f "$REPO_DIR/layouts/natsu.json" "$HERDR_HOME/layouts/natsu.json"
touch "$HERDR_HOME/keys.json"
node -e '
const fs = require("fs");
const [, , dest, src] = process.argv;
let destJson = {};
try { destJson = JSON.parse(fs.readFileSync(dest, "utf8")); } catch {}
const srcJson = JSON.parse(fs.readFileSync(src, "utf8"));
Object.assign(destJson, srcJson);
fs.writeFileSync(dest, JSON.stringify(destJson, null, 2) + "\n");
' "$HERDR_HOME/keys.json" "$REPO_DIR/keys.json"

echo "==> MCP: natsu-hc"
(cd "$REPO_DIR/mcp" && npm install)
claude mcp add -s user natsu-hc -- node "$REPO_DIR/mcp/server.js" 2>&1 | grep -v "already exists" || true

echo "==> MCP: natsu-browser (agent-browser)"
npm install -g agent-browser
agent-browser install
(cd "$REPO_DIR/mcp-browser" && npm install)
claude mcp add -s user natsu-browser -- node "$REPO_DIR/mcp-browser/server.js" 2>&1 | grep -v "already exists" || true

echo "==> MCP: agent-desktop"
npm install -g agent-desktop
claude mcp add -s user agent-desktop --transport stdio -- agent-desktop mcp 2>&1 | grep -v "already exists" || true

echo "==> Switching layout"
herdr-app do layout.switch --name natsu 2>/dev/null || echo "    (couldn't switch automatically — press ctrl-shift-l in Herdr and pick natsu)"

echo
echo "Done. Restart Herdr (or reload its mods) to pick everything up."
echo "Check Settings > MCP / Agent Desktop / Browser in Herdr for live status."
