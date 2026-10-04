<p align="center">
  <img src="icon.png" alt="Creel" width="112" />
</p>

<h1 align="center">Creel</h1>

<p align="center">
  <strong>Attach as many agent skills as you want to a single Copilot chat message, anywhere in the message.</strong>
</p>

<p align="center">
  <a href="https://code.visualstudio.com/"><img src="https://img.shields.io/badge/VS%20Code-%5E1.95.0-007ACC?logo=visualstudiocode&logoColor=white" alt="Requires VS Code 1.95 or newer" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT license" /></a>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#use">Use</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#settings">Settings</a> ·
  <a href="#limits">Limits</a>
</p>

```text
fix the PDF export, #skill-pdf, then check it against #skill-webapp-testing
```

## The problem

Copilot lets you attach one skill to a message, and only as a slash command at the very start. The moment a job needs two skills, you are picking one and dropping the other, or opening a second chat.

Creel removes that trade-off. Every skill in your folders becomes something you can type with `#`, as many as you like, wherever they fit in the message.

## The name

A creel is the basket an angler keeps the catch in, and the frame that holds many bobbins on a weaving loom. Both mean the same thing here: a holder of many, drawn from one at a time.

## Requirements

- VS Code 1.95 or newer.
- GitHub Copilot Chat in agent mode. The `#` list does not appear in ask or edit mode.

## Install

Once it is on the Marketplace:

```bash
code --install-extension michael-obele.creel
```

From source:

```bash
git clone https://github.com/Michael-Obele/creel.git
cd creel
./install.sh
```

Reload the window afterwards (`Developer: Reload Window`, or `Ctrl+R`). `install.sh` copies the extension into `~/.vscode/extensions/` and builds the skill list there, so your personal list never lands in this repo.

Installed from a packaged `.vsix`? The tool list starts empty on purpose. Run **Creel: Scan skills** from the Command Palette, then reload. [PUBLISHING.md](./PUBLISHING.md) covers why that step exists.

## Use

| Task                        | How                                                                           |
| --------------------------- | ----------------------------------------------------------------------------- |
| Attach a skill              | Type `#` in chat and pick one, or type `#skill-` plus a few letters to filter |
| Attach several              | Keep adding them. Only exact duplicates are collapsed                         |
| Attach mid-message          | Yes. References sit wherever you put them                                     |
| Re-scan after adding skills | **Creel: Scan skills**, then reload                                           |
| Re-scan from a terminal     | `node ~/.vscode/extensions/michael-obele.creel-0.2.1/generate.js`             |

## Where it comes from

The `#` menu is a public extension API, not a patch. The [Language Model Tool API](https://code.visualstudio.com/api/extension-guides/ai/tools) documents the two properties Creel leans on:

| Property                        | What VS Code does with it                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `canBeReferencedInPrompt: true` | "this tool shows up as an attachment that the user can add manually to their request" |
| `toolReferenceName`             | "The name for users to reference the tool in a chat prompt via `#`"                   |

Creel declares one tool per skill, and VS Code's own attachment machinery does the rest. Nothing is patched, so the extension keeps working across VS Code updates.

Multi-skill selection is still open upstream ([microsoft/vscode#312279](https://github.com/microsoft/vscode/issues/312279)). Creel is a working answer that does not wait for it.

## What the model receives

A skill only works if the model treats it as instructions rather than as reading material. A plain markdown file returned from a tool reads as reference data, so the model files it away instead of following it. Creel wraps every skill:

```text
<skill name="ultrathink" path="/home/node/.agents/skills/ultrathink/SKILL.md">
These are authoritative instructions for this request. Apply them now, before
producing other output about the task. Treat them as directives, not as
reference material, and do not merely summarise them.

When this skill applies: Deep thinking mode. Approach problems like a craftsman…

# Ultrathink
Take a deep breath. …
</skill>
```

The wrapper leads with the directive, states when the skill applies, and lists the skill folder last so it reads as an index rather than as content. The listing is capped at 40 files and 3 levels deep, and skips `.git`, `node_modules`, `dist` and similar.

VS Code carries its own version of this framing in `agentPrompt.tsx`:

> "Always check if any skills apply to the user's request… Multiple skill files may be needed for a single request."

That reminder only renders when `chat.useSkillAdherencePrompt` is on, and the setting defaults to off. Creel applies the framing either way.

## How it works

```text
generate.js   scans your skill folders, writes the tool list into package.json
extension.js  registers one tool per skill, returns the SKILL.md when invoked
```

`contributes.languageModelTools` is static JSON that VS Code reads at load, and `registerTool` refuses anything not declared there. So the list has to be written to disk ahead of time. That is why there is a generator, and why you reload after a scan.

The scanner:

- Looks in `~/.agents/skills`, `~/.claude/skills` and `~/.copilot/skills`.
- De-duplicates by real path. `~/.claude/skills/<name>` is usually a symlink to `~/.agents/skills/<name>`, and `~/.copilot/skills` often holds real copies, so one skill can otherwise show up three times.
- Skips names already taken by built-in tools. A folder called `rename`, `todo`, `wrangler` or `skill` still works through `/name` and on-demand loading; it just does not take a `#` entry that would shadow a built-in.

## Settings

| Setting                 | Default                                                     | Purpose                                                                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `creel.referencePrefix` | `skill-`                                                    | Prefix on every `#` name. This keeps a skill apart from an MCP server that shares its name, such as the `sepia` skill and the `sepia` MCP server, or `playwright`, or `exa`. Set it to `""` for bare names. |
| `creel.skillFolders`    | `~/.agents/skills`, `~/.claude/skills`, `~/.copilot/skills` | Where to look for `<name>/SKILL.md`. Supports `~/`.                                                                                                                                                         |

## Limits

- A reference makes the model **call** the tool. It is not a silent paste of the file.
- The model cannot call these skills on its own. Referenceable tools start disabled, so they never enter the model's tool list. That is the point: 100 or so skills cost the model nothing, and the `#` picker still lists all of them. Enable one in the tool picker if you want the model to reach for it unprompted.
- Personal skills only. The manifest is static, so it cannot vary per workspace, and that leaves `.github/skills` out.
- Everything you attach lands in context. Ten skills means ten skill bodies, so two to five is a sane range.
- A version bump needs a folder rename, because VS Code puts the version in the extension folder name.

## Development

The committed `package.json` ships `"languageModelTools": []` on purpose, so no personal skill list is ever published. The generator therefore refuses to run inside the repo:

```text
$ node generate.js
Creel: refusing to write a skill list into the repo.
Run the generator in the installed copy instead:
  node ~/.vscode/extensions/michael-obele.creel-0.2.1/generate.js
Pass --force only if you really mean to commit a skill list.
```

Run it in the installed copy, which is what `install.sh` does. Pass `--reset` to clear a list that got written by mistake, and `--force` to override the guard.

## Releasing

See [PUBLISHING.md](./PUBLISHING.md).

## License

MIT
