# Creel glossary

The words this project uses, and what they mean here. One term, one meaning.
No implementation detail belongs in this file.

## The extension

**Creel**
The VS Code extension in this repository. It publishes the identifier
`michael-obele.creel`.

**Skill**
A folder that holds a `SKILL.md` file, and optionally other files. The
`SKILL.md` file holds instructions. An agent reads those instructions to do a
specialized task.

**Skill folder**
A directory that holds skill folders. Creel reads three by default:
`~/.agents/skills`, `~/.claude/skills`, and `~/.copilot/skills`.

**Skill set**
The collection of skills on one machine. A skill set belongs to the machine
owner. Creel does not ship a skill set.

**Scan**
The operation that reads the skill folders and writes the skill list to disk.

**Skill list**
The record of the skills that the last scan found. Creel writes it to
`skills.json`.

## The language model

**Tool**
A function that a language model can call.

**Language model tool**
A tool that a VS Code extension declares. Not all tools are language model
tools.

**Built-in skill tool**
The tool that VS Code itself provides to read a `SKILL.md` file. Its name is
`skill`.

**Loader**
The tool `creel_loadSkill`. A language model calls it to read one skill with no
reference.

**Manifest**
The `package.json` file of an extension. VS Code reads the manifest at load
time. The manifest is static: it cannot change while VS Code runs.

## Using a skill

**Reference**
The text `#name` that a user types in the chat input, where `name` is a
reference name.

**Reference name**
The name that follows the `#`. Creel gives each skill one reference name, for
example `skill-tdd`.

**Attach**
To put a reference in a message. Attach is a user action.

**Load**
To send the body of a skill to the language model. Load is a model action.
Attach and load are different things. A skill that is attached is not always
loaded.

**Route**
The way a skill reached the language model. There are three routes: creel, the
built-in skill tool, and no route.

**Forced call**
A call that VS Code makes because the user attached the tool.

**Autonomous call**
A call that the language model makes by itself.

**Blocked skill**
A skill whose frontmatter sets `disable-model-invocation: true`. VS Code does
not load a blocked skill automatically.

## Creel's answer to a reference

**Wrapper**
The text that Creel puts before and after a skill body.

**Variant**
The shape of the wrapper. Creel ships four: `baseline`, `design-doc`,
`must-keep`, and `native`.

**Verdict**
The result for one reference in one message. The verdicts are `HIT`, `FAILED`,
`NATIVE`, `SKIPPED`, `UNRESOLVED`, and `QUOTED`.

**Miss**
A verdict that means the skill did not arrive through Creel. The miss verdicts
are `SKIPPED`, `UNRESOLVED`, and `FAILED`.

**Dashboard**
The QuickPick that shows the verdicts of the last message. The status bar item
opens the dashboard.

**Report**
The Markdown file that holds the full audit. Creel writes it to the workspace
storage folder.
