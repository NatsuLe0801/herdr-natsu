# herdr-natsu

A bundle of mods and MCP servers for the [Herdr](https://herdr.dev) desktop app, wired together into one `natsu` layout:

| Mod | What it does |
| --- | --- |
| `natsu-folders` | Colored, foldable folders for the spaces list (see below). |
| `natsu-settings` | A Settings page (gear icon) that installs/repairs the three MCP servers below and shows their live status. |
| `natsu-browser-view` | A Browser panel driven by [`agent-browser`](https://www.npmjs.com/package/agent-browser): URL bar, tabs, live screenshot, exposed to agents as the `natsu-browser` MCP server. |
| `natsu-status` | Status bar: active space's machine, agent counts, CPU/RAM/GPU per machine. |
| `natsu-tabs` | The top panel bar (Files / Changes / Settings / Browser), remembered per space. |
| `natsu-agents` | Agents list in grouped/priority views, with live Claude Code context-window usage. |

Plus two more MCP servers it sets up (not mods — plain CLIs agents call through Claude Code):

- **`natsu-hc`** (`mcp/`) — full access to [`hc`](https://github.com) across every paired machine.
- **`agent-desktop`** ([vercel-labs/agent-desktop](https://github.com/vercel-labs/agent-desktop)) — accessibility-tree desktop control (snapshot, click, type), installed from npm and registered as its own MCP server.

## Install — one command

```sh
curl -fsSL https://raw.githubusercontent.com/NatsuLe0801/herdr-natsu/main/install.sh | sh
```

Requires `git`, `node`/`npm`, and the `claude` CLI on PATH. The script clones (or updates) this repo into `~/.config/herdr-app/mods/herdr-natsu`, symlinks every mod above into `~/.config/herdr-app/mods/`, copies the `natsu` layout, merges its `layout:natsu` keys into your `keys.json`, installs `agent-browser` and `agent-desktop` from npm, registers all three MCP servers with Claude Code, and switches Herdr to the `natsu` layout. Safe to re-run — every step is idempotent.

Afterwards, open Settings (gear icon in the top bar) to see each server's install status, and `Repair` anything the script couldn't finish unattended (e.g. if `claude` wasn't on PATH yet).

## Natsu Folders

Folders for the spaces list of the [Herdr](https://herdr.dev) desktop app. Drag spaces into colored folders, fold the ones you're not working on, start new spaces right inside a folder, and let folders collect the spaces of a project by themselves.

- **Folders in the sidebar.** A folder has a colored tile like a space's avatar, a count, and folds away. A folded folder still shows when an agent in it is done or needs you.
- **Drag and drop.** Drop a space on a folder to file it, on a space to put it there and in that space's folder, or below the list to take it out. Drag folders to put them in order.
- **New spaces in a folder.** A folder's **+** (or **New space here**) opens a space in the folder's start folder, already in the folder. A space you make with Herdr's new-space keys (or the palette) goes right under the space you're in, in its folder, instead of at the bottom. The **+** at the top of the list and on a machine's header still make one in no folder.
- **Smart folders.** A folder collects the spaces working in folders that match its rules: `wbso-ai` (a folder name anywhere), `~/code/client-*` (a path, `*` for one folder name). When several folders match, the most specific rule wins: with `~/projects` on one folder and `~/projects/client` on another, spaces in `~/projects/client` go to the second. What you drag yourself goes first.
- **Machines in a folder.** A folder on this computer can take in another machine as well, with its header and its spaces: a rule that matches the machine's name (`vm-*`) or the folder one of its spaces works in puts it there, so throwaway VMs for a project land in that project's folder by themselves.
- **Keys that follow the list.** Option up and down (and Herdr's other next/previous space keys) go to the space above or below in the list as it shows, folders and all, past folded folders. Close the space you're in and you land on the one above it in the list.
- **The same everywhere.** Folders are saved in the home of the machine the spaces run on (`~/.config/herdr-natsu-folders.json`), so every screen that connects to that machine shows the same folders.
- **Everything the spaces list already does.** It's Herdr's own spaces mod with folders added: worktrees under their repo, branch and ahead/behind, a group per machine, colors, the right-click menu.

Right-click a folder to color it, open a new space in it, edit it or delete it. **Edit folder…** sets its name, the folder new spaces start in (**Choose…** opens the system's folder picker) and the rules it collects spaces with.

### Manual install (just this mod)

This mod and layout already live in `~/.config/herdr-app/mods/herdr-natsu/`. To use them without the one-command installer above, link the mod into Herdr's home and copy the layout:

```sh
ln -s ~/.config/herdr-app/mods/herdr-natsu/mods/natsu-folders ~/.config/herdr-app/mods/natsu-folders
cp ~/.config/herdr-app/mods/herdr-natsu/layouts/natsu.json ~/.config/herdr-app/layouts/
herdr-app do layout.switch --name natsu
```

`natsu` is Herdr's own `main` layout (0.1.10) with the spaces list swapped for this one. `ctrl-shift-l` switches back to any other layout.

Then add the `layout:natsu` section of `mods/herdr-natsu/keys.json` to `~/.config/herdr-app/keys.json`. Without it, `alt-up` and `alt-down` stay Herdr's own `space.prev` and `space.next`, which go by the order Herdr keeps the spaces in, not the order of the folders.

### Your own layout

In a layout of your own, point the spaces block at this mod:

```json
{ "id": "spaces", "type": "block", "size": { "weight": 1 }, "min": 90, "content": { "mod": "natsu-folders" } }
```

and give `keys.json` the same keys in a section named after that layout, `layout:<name>`.

## How folders are kept

Each machine's folders live in `~/.config/herdr-natsu-folders.json` in that machine's home: the folders in order (name, color, start folder, rules, folded) and which space went in which folder, by the id that machine knows the space by. A change shows at once and is written to the machine right away; changes from another screen come in within 15 seconds.

## License

MIT (`LICENSE`). The mod started as a copy of the spaces mod that ships with [Herdr](https://herdr.dev); that code keeps Herdr's Apache License 2.0 (`LICENSE-APACHE`).
