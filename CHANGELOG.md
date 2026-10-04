# Changelog

## 0.2.0

Skills now arrive as **instructions**, not as documents.

- The tool result is wrapped in a `<skill name="…" path="…">` tag with an
  explicit directive: apply now, before producing other output, as directives
  rather than reference material.
- The skill's own "when this applies" description is included, so the model can
  judge fit.
- The skill folder's files are listed (names only, capped, common build and
  cache folders skipped) so the model knows what it may read next. This mirrors
  the built-in skill tool's related-files listing.
- Tool descriptions now say the content is authoritative, matching the wording
  the built-in `skill` tool uses for its blocking directive.

Why: a bare markdown body returned from a tool reads as *reference data*. The
built-in reminder that fixes this — "Always check if any skills apply… Multiple
skill files may be needed for a single request" — only renders when
`chat.useSkillAdherencePrompt` is enabled, and that setting defaults to false.
Nkana applies the framing unconditionally, so it behaves that way by default.

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
- `Nkana: Scan skills` command, so an installed copy can build its own list.
