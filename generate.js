"use strict";
/**
 * Creel: the scanning half.
 *
 * Everything that turns "folders full of SKILL.md" into "a `#`-referenceable
 * tool per skill" lives here, so the CLI (`node generate.js`) and the
 * `Creel: Scan skills` command share one implementation.
 *
 * Why a generator exists at all: `contributes.languageModelTools` is static
 * JSON in the manifest. VS Code reads it when the extension loads, and the
 * stable `vscode.lm.registerTool` API refuses tools that are not declared
 * there. So the list has to be written to disk ahead of load. There is no
 * runtime-only path outside the proposed `registerToolDefinition` API.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/**
 * `#` names already owned by VS Code or the Copilot extension.
 * A skill whose folder name collides is SKIPPED rather than registered, so it
 * can never silently shadow a built-in tool. It still works exactly as before
 * via `/name` and on-demand loading. It just does not get a `#` entry.
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
 * Find every skill folder, de-duplicated by its REAL path.
 *
 * This matters: `~/.claude/skills/<name>` is usually a symlink to
 * `~/.agents/skills/<name>`, and `~/.copilot/skills` often holds real copies,
 * so the same skill can appear three times.
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

/** Turn collected skills into manifest entries plus the id -> skill map. */
function buildEntries(skills, prefix) {
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
    const id = `creel_${ref.replace(/[^a-z0-9]+/g, "_")}`;

    tools.push({
      name: id,
      toolReferenceName: ref,
      displayName: `${title} (skill)`,
      userDescription: summary.slice(0, 200),
      modelDescription:
        `Load the "${title}" skill. Its instructions are authoritative for this request. ` +
        `Apply them before producing other output about the task; they are directives, ` +
        `not reference material. ${summary}`,
      canBeReferencedInPrompt: true,
      icon: "$(lightbulb)",
      tags: ["skills", "creel"],
      inputSchema: { type: "object", properties: {} },
    });
    paths[id] = { path: skill.skillFile, name: title, description: summary };
  }

  return { tools, paths, skipped };
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
  } catch {
    // Settings are unavailable outside the extension host; use defaults.
  }

  const prefix = settings.prefix ?? "skill-";
  const folders = settings.folders ?? [
    "~/.agents/skills",
    "~/.claude/skills",
    "~/.copilot/skills",
  ];

  const { tools, paths, skipped } = buildEntries(scanSkills(folders), prefix);

  fs.writeFileSync(
    path.join(extensionDir, "skills.json"),
    JSON.stringify(paths, null, "\t") + "\n",
  );
  manifest.contributes.languageModelTools = tools;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");

  return { count: tools.length, skipped };
}

/** Read `creel.referencePrefix` if we are running inside VS Code. */
function readConfiguredPrefix() {
  const vscode = require("vscode");
  return vscode.workspace.getConfiguration("creel").get("referencePrefix");
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

module.exports = { RESERVED, scanSkills, buildEntries, apply, reset };

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
  if (fs.existsSync(path.join(__dirname, ".git")) && !args.includes("--force")) {
    console.error(
      "Creel: refusing to write a skill list into the repo.\n" +
        "Run the generator in the installed copy instead:\n" +
        "  node ~/.vscode/extensions/michael-obele.creel-0.2.0/generate.js\n" +
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
