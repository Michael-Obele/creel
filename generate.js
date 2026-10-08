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

/** Parse the YAML frontmatter of a SKILL.md without a YAML parser. */
function readFrontmatter(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return {};
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!match) {
    return {};
  }
  const out = {};
  for (const key of ["name", "description"]) {
    const m = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(match[1]);
    if (m) {
      out[key] = m[1].trim().replace(/^['"]|['"]$/g, "");
    }
  }
  // VS Code's own loader reads this flag and answers "Skill not found". Creel
  // cannot lift the block — and mimicking native means keeping the frontmatter
  // as-is — so it records the flag and telemetry reports the list. The skill
  // stays reachable through creel_loadSkill and through #.
  const blocked = /^disable-model-invocation:\s*(.+)$/m.exec(match[1]);
  if (
    blocked &&
    /^(true|yes|1)$/i.test(blocked[1].trim().replace(/^['"]|['"]$/g, ""))
  ) {
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
 * `baseline` keeps the wording creel has always shipped. The other variants
 * drop the `#` clause — the tool name already encodes it — and the sentence
 * arguing against the built-in skill tool, per
 * docs/plans/2026-10-05-prompt-simplification-design.md. Measured across the
 * 101 registered tools: 9,949 chars full versus 3,106 lean, about 1,711 tokens
 * off every request whether or not anything is attached.
 *
 * @param {string} variant `baseline` or the simplified shapes
 * @param {string} title frontmatter name, or the folder name
 * @param {string} ref the `#` reference, e.g. `skill-tdd`
 * @returns {string}
 */
function standingDescription(variant, title, ref) {
  if (variant === "baseline") {
    return `Load the "${title}" skill for #${ref}. Use this tool, not the generic skill tool.`;
  }
  return `Load the "${title}" skill.`;
}

/** Turn collected skills into manifest entries plus the id -> skill map. */
function buildEntries(skills, prefix, variant = "baseline") {
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
    const summary = (meta.description || `The ${title} skill.`).slice(0, 900);
    // The id is what the model sees as the function name, so it stays plain:
    // `skill_tdd`, not a branded prefix it has no use for.
    const id = ref.replace(/[^a-z0-9]+/g, "_");

    tools.push({
      name: id,
      toolReferenceName: ref,
      displayName: `${title} (skill)`,
      userDescription: `Attach with #${ref}. ${summary}`.slice(0, 200),
      // Paid for on every request — ~101 of these sit in the tool list at
      // once, whether or not anything is attached, so this is the only text
      // that can change the decision to call. The framing that shapes the
      // payload is in renderSkill, after the call.
      // Measured: a long BLOCKING/NEVER version changed nothing.
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
  const variant = settings.variant ?? "baseline";
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
        "  node ~/.vscode/extensions/michael-obele.creel-0.4.0/generate.js\n" +
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
