"use strict";
/**
 * The scanning half.
 *
 * `contributes.languageModelTools` is static JSON read at load, and
 * `registerTool` refuses anything not declared there — so the list must be
 * written to disk ahead of time. Hence a generator.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/**
 * `#` names owned by VS Code or Copilot. A collision is skipped, never shadowed —
 * the skill still works via `/name` and on-demand loading, it just gets no `#`.
 */
const RESERVED = new Set([
  // Copilot / chat
  "skill",
  "toolSearch",
  "new",
  "artifacts",
  "artifactRules",
  // editor + workspace
  "rename",
  "usages",
  "extensions",
  "selection",
  "debugConsole",
  "search",
  // terminal
  "runInTerminal",
  "sendToTerminal",
  "terminalSelection",
  "killTerminal",
  "getTerminalOutput",
  "getTerminalSelection",
  // testing / questions
  "runTests",
  "testFailure",
  "askQuestions",
  "todo",
  // browser tools
  "openBrowserPage",
  "readPage",
  "clickElement",
  "hoverElement",
  "dragElement",
  "typeInPage",
  "navigatePage",
  "screenshotPage",
  "runPlaywrightCode",
  "handleDialog",
  "listBrowserPages",
]);

/** Expand a leading `~/` without pulling in a dependency. */
function expandHome(folder) {
  return folder.startsWith("~")
    ? path.join(os.homedir(), folder.slice(1))
    : folder;
}

/** Collapse whitespace runs to single spaces. Every surface here is one line. */
function oneLine(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cut to `max` on a word boundary and mark the cut with an ellipsis.
 *
 * Shared by the description people read and the `When:` clause the model reads,
 * so the two cannot disagree about what "capped" means. The `> 60` guard keeps a
 * pathological first word from collapsing the result to a bare ellipsis.
 */
function cap(text, max) {
  const s = String(text ?? "");
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 60 ? lastSpace : max).trim()}…`;
}

/** Strip matching outer quotes, honouring YAML's escapes inside a double-quoted scalar. */
function unquote(value) {
  const v = String(value ?? "").trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1).replace(/''/g, "'");
  }
  return v;
}

/**
 * One YAML scalar, and the index of its last consumed line.
 *
 * A SKILL.md frontmatter is a handful of keys and only `description` matters.
 * Its *style* decides whether it reads at all, and skill authors use every shape:
 *
 *   description: One line.        plain
 *   description: >                folded — lines join with spaces
 *     Two lines that join.
 *   description: >-               folded, chomping stripped
 *   description: |                literal — newlines kept
 *
 * The previous reader matched `^key:\s*(.+)$` per line, so a block scalar came
 * back as the marker itself — `">"`. Eleven of 108 skills did, and they are the
 * ones written with the longest, most trigger-rich descriptions.
 *
 * Folded and literal collapse identically here: every consumer wants one line (a
 * picker row, a `When: …` clause, a payload label), so the block style never
 * survives past this point. Chomping only affects trailing newlines, which the
 * same collapse removes. That is a decision, not an oversight, and
 * `tests/frontmatter.cjs` pins it so a later reader sees it was deliberate.
 *
 * @param {string[]} lines frontmatter lines, fences removed
 * @param {number} index index of the `key:` line
 * @param {string} inline everything after `key:` on that line
 * @returns {{value: string, last: number}}
 */
function readScalar(lines, index, inline) {
  const block = /^([>|])([-+]?)(\d*)\s*$/.exec(String(inline ?? "").trim());
  if (!block) return { value: oneLine(unquote(inline)), last: index };

  const declaredIndent = block[3];
  const body = [];
  let indent = declaredIndent ? Number(declaredIndent) : 0;
  let last = index;

  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      body.push("");
      last = i;
      continue;
    }
    const leading = line.length - line.trimStart().length;
    if (!indent) {
      if (!leading) break; // not indented: the next top-level key
      indent = leading; // the first non-blank line sets the block's indent
    }
    if (leading < indent) break; // dedented: the block has ended
    body.push(line.slice(indent));
    last = i;
  }

  return { value: oneLine(body.join(" ")), last };
}

/**
 * Parse the frontmatter block into a `key -> value` map of one-line strings.
 *
 * Only column-0 `key:` lines are read, so an indented line belongs either to a
 * nested map (`metadata:`) or to a block scalar already consumed.
 *
 * @param {string} raw the whole file
 * @returns {Record<string, string>}
 */
function parseFrontmatter(raw) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(raw ?? ""));
  if (!block) return {};

  const lines = block[1].split(/\r?\n/);
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z][\w-]*):(.*)$/.exec(lines[i]);
    if (!m) continue;
    const { value, last } = readScalar(lines, i, m[2]);
    out[m[1]] = value;
    i = last;
  }
  return out;
}

/** Parse the YAML frontmatter of a SKILL.md without a YAML parser. */
function readFrontmatter(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return {};
  }

  const meta = parseFrontmatter(raw);
  const out = {};
  if (meta.name) out.name = meta.name;
  if (meta.description) out.description = meta.description;

  // VS Code's own loader reads this flag and answers "Skill not found". Creel
  // cannot lift the block — and mimicking native means keeping the frontmatter
  // as-is — so it records the flag and telemetry reports the list. The skill
  // stays reachable through creel_loadSkill and through #.
  if (/^(true|yes|1)$/i.test(meta["disable-model-invocation"] || "")) {
    out.blocked = true;
  }
  return out;
}

/** `#` names must be whitespace-free; keep them boring and typeable. */
function toReferenceName(folderName) {
  return folderName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Every skill folder, de-duplicated by real path. The same skill is usually
 * symlinked into all three roots, and `~/.copilot/skills` often holds copies.
 */
function scanSkills(folders) {
  const byRealPath = new Map();

  for (const folder of folders) {
    const root = expandHome(folder);
    if (!fs.existsSync(root)) {
      continue;
    }
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }
      const dir = path.join(root, entry.name);
      const skillFile = path.join(dir, "SKILL.md");
      if (!fs.existsSync(skillFile)) {
        continue;
      }
      let real;
      try {
        real = fs.realpathSync(dir);
      } catch {
        continue;
      }
      if (byRealPath.has(real)) {
        continue;
      }
      byRealPath.set(real, {
        folderName: entry.name,
        skillFile: fs.realpathSync(skillFile),
      });
    }
  }
  return [...byRealPath.values()];
}

/**
 * The standing text for one tool: the whole argument for calling it, and the
 * only surface paid for on every request.
 *
 * `must-keep` is the default, and what creel ships: one sentence, no `#` clause
 * and no sentence arguing against the built-in skill tool. `baseline` restores
 * the wording creel shipped before that decision — directive, the `#` clause,
 * and the anti-native sentence — and exists only as the control arm for the
 * comparison in docs/plans/2026-10-05-prompt-simplification-design.md, so it is
 * reachable only by setting `creel.wrapperVariant` to `baseline` on purpose.
 * Measured on 2026-10-05, across the then-101 registered tools: 9,949 chars
 * full versus 3,106 lean, about 1,711 tokens off every request whether or not
 * anything is attached.
 *
 * @param {string} variant `baseline` or the simplified shapes
 * @param {string} title frontmatter name, or the folder name
 * @param {string} ref the `#` reference, e.g. `skill-tdd`
 * @returns {string}
 */
function standingDescription(variant, title, ref) {
  return variant === "baseline"
    ? `Load the "${title}" skill for #${ref}. Use this tool, not the generic skill tool.`
    : `Load the "${title}" skill.`;
}

/** Turn collected skills into manifest entries plus the id -> skill map. */
function buildEntries(skills, prefix, variant = "must-keep") {
  const tools = [];
  const paths = {};
  const used = new Set(RESERVED);
  const skipped = [];

  for (const skill of skills.sort((a, b) =>
    a.folderName.localeCompare(b.folderName),
  )) {
    const base = toReferenceName(skill.folderName);
    if (!base) {
      skipped.push(`${skill.folderName} (empty after sanitising)`);
      continue;
    }
    const ref = `${prefix}${base}`;
    if (used.has(ref)) {
      skipped.push(`${skill.folderName} (#${ref} already taken)`);
      continue;
    }
    used.add(ref);

    const meta = readFrontmatter(skill.skillFile);
    const title = meta.name || skill.folderName;
    // One cap for every consumer, applied here so the picker row, skills.json and
    // the injected payload cannot disagree about where the description ends. The
    // real corpus maxes out at 895 chars, so this only bounds pathological input.
    const summary = cap(meta.description || `The ${title} skill.`, 900);
    // The id IS the `#` name. VS Code's tool-name pattern is
    // `^(?!copilot_|vscode_)[\w-]+$`, so hyphens are legal, and the model's
    // name-only tool-reference hint then matches the tool it must call.
    // Naming these `skill_tdd` while the reference was `skill-tdd` meant the
    // hint and the tool list disagreed by one character.
    const id = ref;

    tools.push({
      name: id,
      toolReferenceName: ref,
      // The `#` widget renders each row as `{source.label}: {displayName}`. The
      // `{source.label}` half is the extension's own name ("Creel: attach skills
      // with #") prepended by VS Code as attribution, so this field is the only
      // text creel controls on that row — and a bare name there ("caveman") says
      // nothing about when the skill applies. Carry the skill's own description,
      // the same words the native `/` menu shows.
      //
      // Capped far tighter than userDescription, because this string has a second
      // consumer: the chat's progress message is `Running ${displayName}` /
      // `Ran ${displayName}`, and a tool reference's `fullName` is this too. A
      // 900-char description would be a paragraph in a status line.
      displayName: cap(summary, 100),
      // The description people read. VS Code renders `userDescription ??
      // modelDescription` everywhere a tool description appears — the `#` picker
      // row, the `Tools…` picker, the attachment-chip hover, the prompt-file
      // hover — and the picker matches on it (`matchOnDescription`), so these
      // words are simultaneously the label and the search key.
      //
      // No creel prefix: `#skill-caveman` is already the label on that same row,
      // and "Creel: attach skills with #" is already the source attribution, so a
      // third statement of the affordance is noise repeated 108 times. It also
      // used to spend the first 20-45 chars of a 200-char budget on plumbing,
      // which cut the skill's own words short for 54 of the 108 skills.
      userDescription: summary,
      // Paid for on every request — 115 of these sit in the tool list at once,
      // whether or not anything is attached, so this is the only text that can
      // change the decision to call. It is deliberately the name and nothing
      // more: the skill's trigger words used to be appended here as a `When: …`
      // clause costing 18,492 chars ≈ 4,623 tokens per request, and 79 of 115
      // were truncated anyway. The description still reaches the model in the
      // payload, after the call lands, which is where renderSkill puts it.
      modelDescription: standingDescription(variant, title, ref),
      canBeReferencedInPrompt: true,
      icon: "$(lightbulb)",
      tags: ["skills"],
      inputSchema: { type: "object", properties: {} },
    });
    paths[id] = {
      path: skill.skillFile,
      name: title,
      description: summary,
      reference: ref,
      ...(meta.blocked ? { blocked: true } : {}),
    };
  }

  return { tools, paths, skipped };
}

/** The one creel tool the model may call without a `#`. */
const LOADER_NAME = "creel_loadSkill";

/**
 * The loader's manifest entry.
 *
 * `canBeReferencedInPrompt: false` is the whole point. A referenceable tool is
 * an attachment: VS Code forces the call once the user types `#`, but the model
 * never sees it before that, so it cannot decide a skill applies and fetch it.
 * This one sits in the tool list permanently, and it is also the only route
 * into the skills carrying `disable-model-invocation: true`.
 *
 * The name list is generated because the model has no other index into creel's
 * skills — the `<skills>` block VS Code prints lists only what its own loader
 * accepts. Names only: the description arrives in the payload, after the
 * decision to call, where it costs nothing extra.
 *
 * @param {string[]} names skill names, already sorted
 * @returns {object} a `contributes.languageModelTools` entry
 */
function loaderEntry(names) {
  const list = names.join(", ");
  return {
    name: LOADER_NAME,
    displayName: "Load skill",
    userDescription: "Load one of the skills Creel has scanned.",
    modelDescription:
      "Load a skill's instructions by name, then follow them before continuing " +
      'with the task. Input: {"skill": "<name>"}. The name is the skill\'s own ' +
      "name, not its # reference." +
      (list ? `\n\nAvailable skills: ${list}` : ""),
    canBeReferencedInPrompt: false,
    icon: "$(lightbulb)",
    tags: ["skills"],
    inputSchema: {
      type: "object",
      properties: {
        skill: {
          type: "string",
          description: 'The skill to load, e.g. "tdd".',
        },
      },
      required: ["skill"],
    },
  };
}

/**
 * Write the manifest and the id -> path map next to this file.
 * @param {string} extensionDir the extension's own folder
 * @returns {{count: number, skipped: string[]}}
 */
function apply(extensionDir) {
  const manifestPath = path.join(extensionDir, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const settings = {};
  try {
    settings.prefix = readConfiguredPrefix();
    settings.folders = readConfiguredFolders();
    settings.variant = readConfiguredVariant();
  } catch {
    // Settings are unavailable outside the extension host; use defaults.
  }

  const prefix = settings.prefix ?? "skill-";
  const variant = settings.variant ?? "must-keep";
  const folders = settings.folders ?? [
    "~/.agents/skills",
    "~/.claude/skills",
    "~/.copilot/skills",
  ];

  const { tools, paths, skipped } = buildEntries(
    scanSkills(folders),
    prefix,
    variant,
  );

  fs.writeFileSync(
    path.join(extensionDir, "skills.json"),
    JSON.stringify(paths, null, "\t") + "\n",
  );

  // The loader is emitted only when there is something to load, so a scan that
  // finds nothing still leaves the manifest empty — which is how the extension
  // tells the user to scan in the first place.
  const names = [...new Set(Object.values(paths).map((skill) => skill.name))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  manifest.contributes.languageModelTools = tools.length
    ? [loaderEntry(names), ...tools]
    : [];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");

  return { count: tools.length, skipped };
}

/** Read `creel.referencePrefix` if we are running inside VS Code. */
function readConfiguredPrefix() {
  const vscode = require("vscode");
  return vscode.workspace.getConfiguration("creel").get("referencePrefix");
}

/** Read `creel.wrapperVariant` if we are running inside VS Code. */
function readConfiguredVariant() {
  const vscode = require("vscode");
  return vscode.workspace.getConfiguration("creel").get("wrapperVariant");
}

/** Read `creel.skillFolders` if we are running inside VS Code. */
function readConfiguredFolders() {
  const vscode = require("vscode");
  return vscode.workspace.getConfiguration("creel").get("skillFolders");
}

/**
 * Clear the tool list, putting the manifest back to its empty-by-design state.
 * Run before committing so a published package never carries a personal skill
 * list.
 * @param {string} extensionDir the extension's own folder
 * @returns {{count: number}} how many tools were removed
 */
function reset(extensionDir) {
  const manifestPath = path.join(extensionDir, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const count = manifest.contributes.languageModelTools?.length ?? 0;
  manifest.contributes.languageModelTools = [];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");
  return { count };
}

module.exports = {
  RESERVED,
  LOADER_NAME,
  scanSkills,
  buildEntries,
  loaderEntry,
  apply,
  reset,
  standingDescription,
  parseFrontmatter,
  readFrontmatter,
  oneLine,
  cap,
};

// CLI entry: node generate.js [--reset] [--force]
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes("--reset")) {
    const { count } = reset(__dirname);
    console.log(`Creel: cleared the tool list (removed ${count} tools).`);
    process.exit(0);
  }

  // The committed manifest must ship an empty tool list, so a published package
  // never carries someone's personal skills. Writing a list into the repo is
  // almost always a mistake, so refuse unless --force is passed.
  if (
    fs.existsSync(path.join(__dirname, ".git")) &&
    !args.includes("--force")
  ) {
    console.error(
      "Creel: refusing to write a skill list into the repo.\n" +
        "Run the generator in the installed copy instead:\n" +
        "  node ~/.vscode/extensions/michael-obele.creel-0.6.0/generate.js\n" +
        "Pass --force only if you really mean to commit a skill list.",
    );
    process.exit(1);
  }

  const { count, skipped } = apply(__dirname);
  console.log(`Creel: ${count} skills are now #-referenceable.`);
  for (const line of skipped) {
    console.log(`  skipped ${line}`);
  }
  console.log(
    "Reload VS Code (Developer: Reload Window), then type # in chat.",
  );
}
