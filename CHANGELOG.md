# Changelog

## 0.3.0

### Debugging what the model actually receives

- `creel.developerMode` turns on two commands that stay hidden from the Command
  Palette otherwise: **Creel: Show last injection** — the exact text a skill
  handed the model, with its variant and size — and **Creel: Preview wrapper**,
  which renders any skill without invoking a model.
- `creel.wrapperVariant` picks the wrapper shape: `baseline` (what ships today),
  `design-doc`, `must-keep` or `native`. It is read on every call, so changing it
  needs no reinstall and no reload.
- In developer mode every invocation is appended to `injections.jsonl` in the
  extension's global storage — tool, variant, size, timestamp — so a turn can be
  attributed to the variant that produced it.
- Scanning inside an Extension Development Host now asks first, because the scan
  result would otherwise land in the committed manifest.

### The audit stops counting misses that did not happen

- `tool.execution_complete` is read at last. A call that reported an error gets
  the new **FAILED** verdict instead of being scored as a hit; a call with no
  recorded completion still reads HIT, rather than inventing a failure.
- References inside pasted or quoted output get the new **QUOTED** verdict and
  are excluded from every rate. Against this machine's transcripts that removed
  25 messages and 13 references, taking the load rate from 56% to 76%.
- **NATIVE** now reads "the skill arrived, but creel's wrapper did not run",
  instead of blaming a directive framing this configuration may not use.

### Housekeeping

- `bun run release`, `build`, `attach` and `bump` automate the version bump,
  the tag, the GitHub release and the `.vsix` build.
- Marketplace listing fields added: `pricing`, `galleryBanner`, `sponsor`.
- A fourth wrapper shape, `must-keep`, keeps the directive, the applicability
  note and the file listing while dropping the precedence paragraph.

### Not in this release

- The wrapper default is still `baseline`. The simplification the design doc
  recommends ships only once real turns show adherence holds.
- The `UNACTED` compliance verdict.

## 0.2.1

README rewritten as a landing page: centered hero with badges and jump links, a
problem-first opening, requirements up front, and a tighter prose pass. No
behaviour change, so the only reason for the release is to get the new listing
copy onto the Marketplace.

## 0.2.0

Renamed to **Creel** before the first release. Nothing was published under the old name, and no user-facing reference changes, because the `#` names are `skill-<name>` and never contained the product name. Only internal tool ids and settings keys moved.

Skills now arrive as instructions the model is told to follow.

- The tool result is wrapped in a `<skill name="…" path="…">` tag that opens
  with an explicit directive: apply now, before producing other output, as
  directives rather than reference material.
- The skill's own "when this applies" description is included, so the model can
  judge whether the skill fits.
- The skill folder's files are listed (names only, capped, with common build and
  cache folders skipped) so the model knows what it may read next. This mirrors
  the built-in skill tool's related-files listing.
- Tool descriptions now say the content is authoritative, matching the wording
  the built-in `skill` tool uses for its blocking directive.

Why: a bare markdown body returned from a tool reads as reference data, so the
model files it away instead of following it. The built-in reminder that fixes
this, "Always check if any skills apply… Multiple skill files may be needed for
a single request", only renders when `chat.useSkillAdherencePrompt` is enabled,
and that setting defaults to false. Creel applies the framing either way.

## 0.1.0

Initial release.

- One `#`-referenceable language model tool per skill, generated from
  `~/.agents/skills`, `~/.claude/skills` and `~/.copilot/skills`.
- Any number of skills attachable to one chat message, anywhere in the message.
- `skill-` reference prefix by default, so skills stay distinguishable from
  same-named MCP servers and built-in tools.
- De-duplication by real path (symlinked and copied skill folders collapse to
  one entry).
- Reserved `#` names are skipped rather than shadowing built-in tools.
- `Creel: Scan skills` command, so an installed copy can build its own list.
