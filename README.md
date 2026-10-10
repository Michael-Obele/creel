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

| Task                        | How                                                                           |
| --------------------------- | ----------------------------------------------------------------------------- |
| Attach a skill              | Type `#` in chat and pick one, or type `#skill-` plus a few letters to filter |
| Attach several              | Keep adding them. Only exact duplicates are collapsed                         |
| Attach mid-message          | Yes. References sit wherever you put them                                     |
| Re-scan after adding skills | **Creel: Scan skills**, then reload                                           |
| Re-scan from a terminal     | `node ~/.vscode/extensions/michael-obele.creel-0.5.0/generate.js`             |

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

## Letting the model choose the skill

Typing `#skill-x` **forces** the call. Creel also ships `creel_loadSkill`, one tool
the model can call on its own:

- It is contributed with `canBeReferencedInPrompt: false`, so unlike the 100-odd
  referenceable tools it sits in the model's tool list permanently. One entry, not
  102 — the `#` picker still lists every skill.
- Its `modelDescription` carries a generated, names-only list of every scanned
  skill. That list is the model's only index into creel: the `<skills>` block VS
  Code prints lists only what its own loader accepts.
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
| `creel.referencePrefix` | `skill-`                                                    | Prefix on every `#` name. This keeps a skill apart from an MCP server that shares its name, such as the `sepia` skill and the `sepia` MCP server, or `playwright`, or `exa`. Set it to `""` for bare names. |
| `creel.skillFolders`    | `~/.agents/skills`, `~/.claude/skills`, `~/.copilot/skills` | Where to look for `<name>/SKILL.md`. Supports `~/`.                                                                                                                                                         |

## What loaded

The status bar shows the last message's verdicts: `$(check) 2/2 skills` when everything arrived through Creel, `$(warning) 1/2 skills` naming what did not, `$(discard)` when a skill arrived through the built-in loader instead.

Click it for the dashboard: one row per attached skill with its verdict and the reason, then the actions. Pressing Enter on a row copies that `#` name, which is the fastest way to attach it again.

| Command                       | What it does                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Creel: Check last message** | Runs the audit now and reports the last message's verdicts.                                                                                   |
| **Creel: Audit report**       | Writes the full report to `audit.md` in this workspace's storage and opens it. The path is also in the dashboard, ready to paste to an agent. |

A message that has no tool call recorded yet is not reported as a miss. Creel reads a transcript while the turn is still running, so it waits for a call before it warns, and the status bar carries the live state in the meantime.

## Limits

- A reference makes the model **call** the tool. It is not a silent paste of the file.
- The 100-odd `#` tools stay referenceable and therefore stay out of the model's tool list — that is deliberate, so they cost nothing per request. Reaching a skill without a `#` goes through `creel_loadSkill` instead: one entry, always visible.
- Personal skills only. The manifest is static, so it cannot vary per workspace, and that leaves `.github/skills` out.
- Everything you attach lands in context. Ten skills means ten skill bodies, so two to five is a sane range.
- A version bump needs a folder rename, because VS Code puts the version in the extension folder name.

## Development

The committed `package.json` ships `"languageModelTools": []` on purpose, so no personal skill list is ever published. The generator therefore refuses to run inside the repo:

```text
$ node generate.js
Creel: refusing to write a skill list into the repo.
Run the generator in the installed copy instead:
  node ~/.vscode/extensions/michael-obele.creel-0.5.0/generate.js
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
