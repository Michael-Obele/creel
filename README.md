# Creel

Attach any number of agent skills to one Copilot chat message, anywhere in the message.

```
fix the PDF export, #skill-pdf, then check it against #skill-webapp-testing
```

## The name

A **creel** is the shallow woven basket an angler carries the catch in. In textile weaving it is also the frame that holds many bobbins and feeds them out.

Both senses mean the same thing here: a holder of many, drawn from one at a time. You keep your skills in the creel and take out the ones the job needs.

The icon is drawn from code rather than committed as a binary, so it can be tweaked:

```bash
python3 scripts/make-icon.py   # needs Pillow; writes icon.png
```

## What it does

VS Code Copilot lets you attach one skill to a message, as a `/skill` slash command at the very start. Creel lifts that limit. Every skill in your folders becomes something you can type with `#`, and you can attach as many as you like, wherever you like in the message.

That works because VS Code's `#` menu is a public extension API. The [Language Model Tool API docs](https://code.visualstudio.com/api/extension-guides/ai/tools) describe two properties:

| Property | What VS Code does with it |
| --- | --- |
| `canBeReferencedInPrompt: true` | "this tool shows up as an attachment that the user can add manually to their request" |
| `toolReferenceName` | "The name for users to reference the tool in a chat prompt via `#`" |

So Creel declares one tool per skill and lets VS Code's own attachment machinery do the rest. Nothing is patched. Because the extension sits in your extensions folder, it survives every VS Code update.

Upstream, multi-skill selection is still an open request: [microsoft/vscode#312279](https://github.com/microsoft/vscode/issues/312279). Creel is a working answer that does not wait for it.

## Install

From the Marketplace, once published:

```
code --install-extension michael-obele.creel
```

From source:

```bash
git clone https://github.com/Michael-Obele/creel.git
cd creel
./install.sh
```

Either way, reload the window afterwards. `Developer: Reload Window`, or `Ctrl+R`.

`install.sh` copies the extension into `~/.vscode/extensions/` and runs the scan there, so your personal skill list never ends up in this repo.

If you install a packaged `.vsix` instead, the tool list starts empty by design. Run `Creel: Scan skills` from the Command Palette, then reload. See [PUBLISHING.md](./PUBLISHING.md) for why that step exists.

## Use

| Task | How |
| --- | --- |
| Attach a skill | Type `#` in chat and pick one, or type `#skill-` plus a few letters to filter |
| Attach several | Just keep adding them. Only exact duplicates get collapsed |
| Attach mid-message | Yes. References sit wherever you put them |
| Re-scan after adding skills | `Creel: Scan skills` from the Command Palette, then reload |
| Re-scan from a terminal | `node ~/.vscode/extensions/michael-obele.creel-0.2.0/generate.js` |

The `#` list only appears in agent mode.

## What the model actually receives

This part matters more than it looks. A skill only works if the model treats what it gets as instructions rather than as reading material. A plain markdown file returned from a tool reads as reference data, so the model files it away instead of following it. Creel wraps every skill:

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

The wrapper leads with the directive, states when the skill applies, and puts the skill folder's file listing last so it reads as an index rather than as content. The listing is capped at 40 files and 3 levels deep, and skips `.git`, `node_modules`, `dist` and similar.

VS Code has its own version of this framing, in `agentPrompt.tsx`. It says:

> "Always check if any skills apply to the user's request… Multiple skill files may be needed for a single request."

It only renders when `chat.useSkillAdherencePrompt` is on, and that setting defaults to off. Creel applies the framing whether or not you have it on.

## How it works

```
generate.js   scans your skill folders, writes the tool list into package.json
extension.js  registers one tool per skill, returns the SKILL.md when invoked
```

`contributes.languageModelTools` is static JSON that VS Code reads when the extension loads, so the list has to be written to disk ahead of time. That is why there is a generator and why you reload after scanning.

The scanner:

- Looks in `~/.agents/skills`, `~/.claude/skills` and `~/.copilot/skills`.
- De-duplicates by real path. `~/.claude/skills/<name>` is usually a symlink to `~/.agents/skills/<name>`, and `~/.copilot/skills` often holds real copies, so the same skill can show up three times.
- Skips names already taken by built-in tools. A skill folder called `rename`, `todo`, `wrangler` or `skill` keeps working through `/name` and on-demand loading, but does not get a `#` entry that would shadow a built-in.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `creel.referencePrefix` | `skill-` | Prefix on every `#` name. This is what keeps a skill apart from an MCP server with the same name, such as the `sepia` skill and the `sepia` MCP server, or `playwright`, or `exa`. Set it to `""` for bare names. |
| `creel.skillFolders` | `~/.agents/skills`, `~/.claude/skills`, `~/.copilot/skills` | Where to look for `<name>/SKILL.md`. Supports `~/`. |

## Limits

- A reference makes the model **call** the tool. It is not a silent paste of the file.
- The model cannot call these skills on its own. Referenceable tools start disabled, so they never enter the model's tool list. That is the point: 100 or so skills cost the model nothing, and the `#` picker still lists all of them. Turn one on in the tool picker if you want the model to reach for it unprompted.
- Personal skills only. The manifest is static, so it cannot vary per workspace, which leaves `.github/skills` out.
- Everything you attach lands in context. Ten skills means ten skill bodies. Two to five is a sane range.
- A version bump needs a folder rename, because VS Code puts the version in the extension folder name.

## Development

The committed `package.json` ships `"languageModelTools": []` on purpose, so no personal skill list is ever published. The generator therefore refuses to run inside the repo:

```text
$ node generate.js
Creel: refusing to write a skill list into the repo.
Run the generator in the installed copy instead:
  node ~/.vscode/extensions/michael-obele.creel-0.2.0/generate.js
Pass --force only if you really mean to commit a skill list.
```

Run it in the installed copy, which is what `install.sh` does. Pass `--reset` to clear a list that got written by mistake, and `--force` to override the guard.

## Releasing

See [PUBLISHING.md](./PUBLISHING.md).

## License

MIT
