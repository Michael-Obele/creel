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

From the Marketplace:

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

| Task                        | How                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attach a skill              | Type `#` in chat and pick one, or type `#skill-` plus a few letters to filter. Each entry shows the skill's own description, read from its SKILL.md |
| Attach several              | Keep adding them. Only exact duplicates are collapsed                                                                                               |
| Attach mid-message          | Yes. References sit wherever you put them                                                                                                           |
| Re-scan after adding skills | **Creel: Scan skills**, then reload                                                                                                                 |
| Re-scan from a terminal     | `node ~/.vscode/extensions/michael-obele.creel-0.7.0/generate.js`                                                                                   |

## Where it comes from

The `#` menu is a public extension API, not a patch. The [Language Model Tool API](https://code.visualstudio.com/api/extension-guides/ai/tools) documents the two properties Creel leans on:

| Property                        | What VS Code does with it                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `canBeReferencedInPrompt: true` | "this tool shows up as an attachment that the user can add manually to their request" |
| `toolReferenceName`             | "The name for users to reference the tool in a chat prompt via `#`"                   |

Creel declares one tool per skill, and VS Code's own attachment machinery does the rest. Nothing is patched, so the extension keeps working across VS Code updates.

Multi-skill selection is still open upstream ([microsoft/vscode#312279](https://github.com/microsoft/vscode/issues/312279)). Creel is a working answer that does not wait for it.

## What the model receives

Creel wraps every skill in a short frame: one directive line, when the skill applies, and the folder listing. The body is passed through untouched.

```text
<skill name="ultrathink" path="/home/node/.agents/skills/ultrathink/SKILL.md" reference="#skill-ultrathink">
Follow these instructions now, before other output about the task.

When this skill applies: Deep thinking mode. Approach problems like a craftsman…

# Ultrathink
Take a deep breath. …
</skill>
```

The listing is capped at 40 files and 3 levels deep, and skips `.git`, `node_modules`, `dist` and similar.

The frame is deliberately small, and Creel does not claim more for it than the evidence supports. Across every skill it is about 600 characters against a body that averages about 7,900, and a small adherence probe in October 2026 (two runs per shape, one model) found the body carrying the adherence with no measurable difference from the frame on top of it. The frame stays for the tag, the applicability note and the file index, not because any particular wording was shown to change behaviour.

VS Code carries its own version of this framing:

> "Always check if any skills apply to the user's request… Multiple skill files may be needed for a single request."

That reminder only renders when `chat.experimental.useSkillAdherencePrompt` is on, and the setting defaults to off. Creel applies its frame either way.

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

## Tool surface

Creel can put its skills in the model's tool list two ways. `creel.toolSurface`
decides, at scan time.

| Value | Shape | Cost with 141 skills | `#skill-x` |
| --- | --- | --- | --- |
| `loader` (default) | one `creel_loadSkill`, plus one `#` tool per hot skill | ~4.1k tokens (15 hot) | for the hot set |
| `tools` | one tool per skill, plus the loader | ~5.9k tokens | for all |

### Pick a preset, don't wire the settings by hand

**Creel: Choose tool surface** from the command palette sets `creel.preset`,
scans, and offers to reload. One dropdown instead of three settings that only
make sense read together.

| `creel.preset` | What you get | Tokens |
| --- | --- | --- |
| `balanced` | The top 20 skills by usage get `#`; the loader carries trigger text | ~4.1k |
| `all` | Every skill gets `#`; the index spends nothing, because the tool names are the index | ~5.2k |
| `loader` | No `#` at all; every skill is reached by name through `creel_loadSkill` | ~3.6k |
| `custom` (default) | Whatever `creel.hotSkills`, `creel.hotCount` and `creel.indexBudget` say | varies |

A preset **replaces** those three settings rather than merging with them, so
`all` cannot end up half-applied, and a pinned list cannot leak into `balanced`.
Set `creel.preset` to `custom` to take control of the individual values.

`all` is the setting behind `"creel.hotSkills": ["*"]` plus
`"creel.indexBudget": 0` — the pair you would otherwise have to write out
yourself. Those two lines still work on their own with `preset` left at `custom`.

`loader` is the default surface because the per-skill tools bought almost
nothing: 141 of them cost 18,441 bytes of schema and every one of their
descriptions said only `Load the "x" skill.` At that size the request also went
past the ceiling where the client stops making tools available, and skills the
model did call came back as failures with no execution behind them.

Every skill is listed inside the loader's description as `- name — when to use
it`, so the model can find any of them on its own. A `#` reference cannot work
that way — it resolves only to a tool, so it costs a tool slot — but it does not
need to cover the whole library.

### The hot set

The top skills by **how often you actually attach them** get a `#` tool of their
own. The count comes from your Copilot chat history: `#skill-x` typed in a
message, a creel `skill-x` call, and the built-in `skill` tool all count, resolved
onto the same skill.

Measured on this machine, the 15 most-used skills cost 521 tokens:

| `creel.hotCount` | `#` tools | tokens |
| --- | --- | --- |
| `0` | 0 | 3,599 |
| `10` | 10 | 3,946 |
| `20` (default) | 15 | 4,120 |

`creel.hotSkills` pins the list instead of deriving it, and `["*"]` means every
skill — ordered by usage, so the trigger budget still goes to the ones you reach
for first. A skill you have never used is never hot on its own — that is the
point, not an oversight.

**Every skill is reachable whether or not it is hot.** The hot set decides which
ones get a `#` chip; the loader index lists all of them by name. `#` for all 141 is
one preset away (`creel.preset: "all"`) and costs about 5.2k tokens without
triggers — but it puts 141 tools back into a request that also carries ~91 MCP
tools and ~43 built-ins, and that count is what makes the client withhold tools.
Cover the library with `#` with an eye on that total.

Only the newest ~64 MB of chat history is read (about a second), because the
ranking does not need an archive: on this machine that is 375 files and 279 MB,
which took 37 seconds to read in full.

`creel.indexBudget` (default `12000`) caps the trigger text both channels may
spend, together. Every skill is always listed by name, so a low budget never
makes one unreachable — it only stops the model from recognising which one
applies from the text alone. `0` gives names only at about 0.9k tokens.

## Letting the model choose the skill

In `loader` mode the model calls `creel_loadSkill`. In `tools` mode typing
`#skill-x` also **forces** the call, and the loader is the fallback:

- It is contributed with `canBeReferencedInPrompt: false`, so it is always the
  one entry in the model's tool list that no `#` can shadow. In `tools` mode the
  `#` picker still lists every skill alongside it.
- Its `modelDescription` carries a generated index of every scanned skill, one
  line each. That index is the model's only complete route into creel: the
  `<skills>` block VS Code prints truncates to roughly the first 38 names on a
  machine with this many skills, and the remainder cannot be resolved by the
  built-in `skill` tool at all.
- It is the **only** route into skills whose frontmatter sets
  `disable-model-invocation: true` (23 on this machine, including `ultrathink` and
  `implement`). VS Code's loader honours that flag and answers "Skill not found".
  Creel does not edit the frontmatter — it works around it.

With `creel.developerMode` on, **Creel: Telemetry** joins `injections.jsonl` against this workspace's transcripts
and reports, per wrapper shape: calls, forced versus autonomous, mean payload size,
the five largest payloads, and anything it could not attribute. Set
`creel.wrapperVariant` to `random` to give the comparison something to compare.

## Settings

| Setting                 | Default                                                     | Purpose                                                                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `creel.preset`          | `custom`                                                    | One dropdown for the whole surface: `balanced`, `all`, `loader`, or `custom`. Replaces the three settings below. See [Pick a preset](#pick-a-preset-dont-wire-the-settings-by-hand).                                            |
| `creel.toolSurface`     | `loader`                                                    | `loader` = one tool for the whole library plus a `#` tool per hot skill. `tools` = one tool per skill. See [Tool surface](#tool-surface).                                                                     |
| `creel.hotCount`        | `20`                                                        | How many skills get a `#` reference of their own, chosen by how often you use them. `0` means no `#`. Overridden by `creel.hotSkills`.                                                                       |
| `creel.hotSkills`       | `[]`                                                        | Pin exactly which skills get a `#` reference (`["*"]` = all). Empty lets usage decide.                                                                                                                      |
| `creel.indexBudget`     | `12000`                                                     | Characters both the loader index and the hot `#` tools may spend on trigger phrases, together. Names are always complete.                                                                                   |
| `creel.referencePrefix` | `skill-`                                                    | Prefix on every `#` name. This keeps a skill apart from an MCP server that shares its name, such as the `sepia` skill and the `sepia` MCP server, or `playwright`, or `exa`. Set it to `""` for bare names. |
| `creel.skillFolders`    | `~/.agents/skills`, `~/.claude/skills`, `~/.copilot/skills` | Where to look for `<name>/SKILL.md`. Supports `~/`.                                                                                                                                                         |

## What loaded

The status bar shows the last message's verdicts: `$(check) 2/2 skills` when everything arrived through Creel, `$(warning) 1/2 skills` naming what did not, `$(discard)` when a skill arrived through the built-in loader instead.

Click it for the dashboard: one row per attached skill with its verdict and the reason, then the actions. Pressing Enter on a row copies that `#` name, which is the fastest way to attach it again.

| Command                       | What it does                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Creel: Choose tool surface** | Pick `balanced`, `all`, `loader` or `custom`, scan, and reload. The fastest way to change how many tools creel costs you.                  |
| **Creel: Check last message** | Runs the audit now and reports the last message's verdicts.                                                                                   |
| **Creel: Audit report**       | Writes the full report to `audit.md` in this workspace's storage and opens it. The path is also in the dashboard, ready to paste to an agent. |

A message that has no tool call recorded yet is not reported as a miss. Creel reads a transcript while the turn is still running, so it waits for a call before it warns, and the status bar carries the live state in the meantime.

## Limits

- A reference makes the model **call** the tool. It is not a silent paste of the file.
- Referenceable tools are enabled by default in the agent panel, so in `tools` mode they do appear in the model's tool list and do cost tokens on every request. The README used to claim otherwise; measurement says 141 tools ≈ 5.9k tokens. `loader` mode exists because that bill bought almost no information.
- The local `<skills>` roster is capped by VS Code at 15,000 characters of descriptions, and the names past that cap cannot be resolved by the built-in `skill` tool. On a machine with ~140 skills that is roughly the first 38 names. Creel's loader index is the only complete list.
- Personal skills only. The manifest is static, so it cannot vary per workspace, and that leaves `.github/skills` out.
- Everything you attach lands in context. Ten skills means ten skill bodies, so two to five is a sane range.
- A version bump needs a folder rename, because VS Code puts the version in the extension folder name.

## Development

The committed `package.json` ships `"languageModelTools": []` on purpose, so no personal skill list is ever published. The generator therefore refuses to run inside the repo:

```text
$ node generate.js
Creel: refusing to write a skill list into the repo.
Run the generator in the installed copy instead:
  node ~/.vscode/extensions/michael-obele.creel-0.7.0/generate.js
Pass --force only if you really mean to commit a skill list.
```

Run it in the installed copy, which is what `install.sh` does. Pass `--reset` to clear a list that got written by mistake, and `--force` to override the guard.

### Debugging what the model receives

The tool list is static JSON read at load, so a development build cannot add
tools the installed copy does not already have. The installed copy is therefore
the test rig, and the debugging aids are settings rather than build flags.

Set `creel.developerMode` to turn on three commands that stay hidden from the
Command Palette otherwise:

| Command                        | What it shows                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| **Creel: Show last injection** | The exact text the last invoked skill handed the model, with its variant and size. |
| **Creel: Preview wrapper**     | Renders any skill's wrapper without invoking a model.                              |
| **Creel: Telemetry**           | Calls, forced versus autonomous, and payload sizes, joined per wrapper shape.      |

`creel.wrapperVariant` picks the wrapper shape, and it is read on every call —
so changing it needs no reinstall and no reload:

| Value                 | Shape                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `must-keep` (default) | One directive line, the applicability note and the file listing. This is what ships.                                                |
| `baseline`            | The legacy shape, kept for comparison: directive, precedence paragraph, applicability note, file listing.                           |
| `design-doc`          | The simplified shape in [the design doc](./docs/plans/2026-10-05-prompt-simplification-design.md): one directive line and the body. |
| `native`              | The built-in skill tool's own result, reproduced from the shipped bundle.                                                           |
| `random`              | Picks one of the four for the whole window and stamps it into every injection — what makes a per-variant comparison possible.       |

Developer mode also switches on automatically in an Extension Development Host
(`F5`), or when a `.creel-dev` file sits in the extension folder. In a
development host **Creel: Scan skills** asks first, because the scan result
would land in the committed `package.json`.

While developer mode is on, every invocation is appended to `injections.jsonl`
in this workspace's storage — tool, variant, size, timestamp — so a turn
can be attributed to the variant that produced it. **Creel: Telemetry** reads
that file back and joins it to the transcripts, and the audit report sits
beside it as `audit.md`.

Every suite runs against a stub `vscode`, so no editor is needed:

```bash
for f in tests/*.cjs; do node "$f"; done
```

`activate-smoke` covers the developer-mode wiring, `report-surface` the report
file and the dashboard, `wrapper-shapes` and `cost-matrix` the wrapper shapes,
`audit-verdicts` and `telemetry-join` the analysis, `load-skill-tool` the
loader, and `release-script` the release script against a throwaway checkout.

## Releasing

Three commands, in this order:

| Command           | What it does                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `bun run release` | Bumps the version in every file that carries it, commits, tags `vX.Y.Z`, pushes, creates the GitHub release. |
| `bun run build`   | Packages `creel-X.Y.Z.vsix` from that version.                                                               |
| `bun run attach`  | Uploads the `.vsix` onto the GitHub release.                                                                 |

Pass `patch` (default), `minor`, `major` or an exact `x.y.z` after `bun run
release`. `bun run bump` stops before anything is pushed, and every command
accepts `--dry-run`, which prints what would change and touches nothing.

The Marketplace upload stays manual: take `creel-X.Y.Z.vsix` to the
[publisher portal](https://marketplace.visualstudio.com/manage/publishers/michael-obele).

Full runbook — what each command edits, the safety rails, and the checks to run
before and after: [PUBLISHING.md](./PUBLISHING.md).

## License

MIT
