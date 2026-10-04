# Changelog

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
