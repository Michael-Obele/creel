# Nkana

**Ịbani (Ijaw) — *basket*.** The basket you carry your skills in.

Attach **any number of agent skills** to a single Copilot chat message, **anywhere in the message**, as `#` references.

```
fix the PDF export, #skill-pdf, then check it against #skill-webapp-testing
```

## Why this is possible at all

VS Code's `#` menu is a **public extension API**, not private UI. From the [Language Model Tool API docs](https://code.visualstudio.com/api/extension-guides/ai/tools):

| Property | What VS Code does with it |
| --- | --- |
| `canBeReferencedInPrompt: true` | *"this tool shows up as an **attachment** that the user can add manually to their request"* |
| `toolReferenceName` | *"The name for users to reference the tool in a chat prompt via `#`"* |

So Nkana declares **one tool per skill** and lets VS Code's own attachment machinery do the rest. Nothing is patched, and because the extension lives in your extensions folder it survives every VS Code update.

Upstream, multi-skill selection is still an open request — [microsoft/vscode#312279](https://github.com/microsoft/vscode/issues/312279). Nkana is a working answer that does not need to wait for it.

## Install (from source)

```bash
git clone https://github.com/Michael-Obele/nkana.git
cd nkana
./install.sh
```

Then **`Developer: Reload Window`** and type `#` in chat.

`install.sh` copies the extension into `~/.vscode/extensions/` and runs the scan **there**, so your personal skill list never ends up in this repo.

## Everyday use

| Task | How |
| --- | --- |
| Attach a skill | Type `#` in chat and pick, or type `#skill-` plus a few letters to filter |
| Attach several | Just add more — there is no limit, and only exact duplicates are collapsed |
| Attach mid-message | Yes — references are positional, so `fix X #skill-a then check #skill-b` works |
| Re-scan after adding skills | `Nkana: Scan skills` from the Command Palette, then reload |
| Re-scan from a terminal | `node ~/.vscode/extensions/michael-obele.nkana-0.1.0/generate.js` |

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `nkana.referencePrefix` | `skill-` | Prefix for every `#` name. **This is what keeps skills distinguishable** from MCP servers and built-in tools that share a name — the `sepia` skill vs the `sepia` MCP server, `playwright`, `exa`, and so on. Set to `""` for bare names. |
| `nkana.skillFolders` | `~/.agents/skills`, `~/.claude/skills`, `~/.copilot/skills` | Where to look for `<name>/SKILL.md`. Supports `~/`. |

## What the model actually receives

A skill only takes effect if the model treats it as **instructions** rather than as reference material. A bare markdown body returned from a tool reads as a *document*, so Nkana frames it:

```text
<skill name="ultrathink" path="/home/node/.agents/skills/ultrathink/SKILL.md">
These are authoritative instructions for this request. Apply them now, before
producing other output about the task. Treat them as directives, not as
reference material, and do not merely summarise them.

When this skill applies: Deep thinking mode - approach problems like a craftsman…

# Ultrathink
Take a deep breath. …
</skill>
```

Three details are deliberate:

- **The directive comes first.** Without it the body is just text that arrived from a tool.
- **The folder listing comes last**, so it reads as an index rather than as content. VS Code's own skill tool lists related files too — that is the progressive-disclosure half of a skill, and Nkana caps it at 40 entries, 3 levels deep, skipping `.git`, `node_modules`, `dist` and friends.
- **The framing is unconditional.** VS Code's equivalent reminder — *"Always check if any skills apply to the user's request… Multiple skill files may be needed for a single request"* — only renders when `chat.useSkillAdherencePrompt` is enabled, and that setting defaults to `false`. Nkana applies the framing whether or not it is on.

## How it works, and the one thing that is awkward

`contributes.languageModelTools` is **static JSON**, read when the extension loads, and the stable `vscode.lm.registerTool` API refuses tools that are not declared there. So the skill list has to be written to disk *before* load — there is no runtime-only path outside the proposed `registerToolDefinition` API, which cannot be published to the Marketplace.

That is the whole reason for the generator and the reload. If upstream ever stabilises `registerToolDefinition`, Nkana collapses to a single activation function with no reload.

```
generate.js   scans folders → writes contributes.languageModelTools + skills.json
extension.js  registers one tool per declared skill; returns the SKILL.md body
```

The scanner also:

- **De-duplicates by real path.** `~/.claude/skills/<name>` is usually a symlink to `~/.agents/skills/<name>`, and `~/.copilot/skills` often holds real copies — the same skill can otherwise appear three times.
- **Skips reserved names.** A skill folder named `rename`, `todo`, `skill`, `wrangler`… keeps working via `/name` and on-demand loading, but does not get a `#` entry that would shadow a built-in tool.

## Honest limitations

- **A reference makes the model *call* the tool** — it is not a silent paste of the file. The model description states that you attached the skill, which makes the call reliable, but it is still a tool call.
- **The model cannot call these on its own.** Referenceable tools default to *disabled* in VS Code, so they never enter the model's tool list. That is the feature — 100+ skills cost the model nothing, and the `#` picker still lists them. Enable one in the tool picker if you want the model to reach for it unprompted.
- **Personal skills only.** A static manifest cannot vary per workspace, so `.github/skills` is out of scope.
- **Everything lands in context.** Attaching ten skills means ten skill bodies. Two to five is the sane range.
- **A version bump needs a folder rename**, because VS Code encodes the version in the extension folder name.

## Development

```bash
node generate.js     # rebuild the tool list in place (dirties package.json by design)
node --check extension.js
```

The committed `package.json` intentionally ships `"languageModelTools": []` so no personal skill list is ever published.

## License

MIT
