"use strict";
// Creel. Registers one language-model tool per skill, and the command that
// (re)builds the tool list.
//
// The interesting part is `renderSkill`. A skill only takes effect if the model
// treats what it receives as INSTRUCTIONS rather than as reference material, so
// the returned text is framed the way VS Code frames its own skills: with an
// explicit directive, the skill's own applicability note, and a listing of the
// skill folder so the model knows what else it may read.
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const { apply } = require("./generate");
const {
  analyze,
  parseTranscript,
  latestTurn,
  toMarkdown,
  knownRefsFromSkills,
} = require("./audit");

/** Folders never worth offering as skill resources. */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".github",
  "__pycache__",
  "coverage",
  "target",
  "bin",
  "obj",
  ".venv",
  "venv",
  "dist",
  "build",
]);

const MAX_LISTED_FILES = 40;
const MAX_DEPTH = 3;

/**
 * The built-in skill tool's own listing, read from the shipped bundle:
 * `oVr=50`, depth 5, and this ignore set. Used by the `native` variant so the
 * comparison is against what VS Code really does, not an approximation of it.
 */
const NATIVE_MAX_FILES = 50;
const NATIVE_MAX_DEPTH = 5;
const NATIVE_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".cache",
  "coverage",
  "__pycache__",
  "target",
  "bin",
  "obj",
  ".venv",
  "venv",
]);

/** Wrapper shapes the runtime can switch between, with no reinstall. */
const VARIANTS = new Set(["baseline", "design-doc", "must-keep", "native"]);

/** What the model was handed this session, newest first. Dev commands read it. */
const MAX_INJECTIONS = 20;
const injections = [];
let outputChannel = null;
let developerMode = false;
let injectionLogPath = null;

/**
 * List the files that sit beside a SKILL.md, relative to the skill folder.
 * Only names are returned. The model reads one only when the instructions ask
 * for it. This is the progressive-disclosure half of a skill.
 * @param {string} skillFile absolute path to the SKILL.md
 * @param {{maxFiles?: number, maxDepth?: number, ignored?: Set<string>}} [options]
 *   defaults to what creel ships; the `native` variant passes the bundle's own
 * @returns {string[]} relative paths, sorted
 */
function listRelatedFiles(skillFile, options) {
  const cap = options?.maxFiles ?? MAX_LISTED_FILES;
  const maxDepth = options?.maxDepth ?? MAX_DEPTH;
  const ignored = options?.ignored ?? IGNORED_DIRS;
  const root = path.dirname(skillFile);
  const found = [];

  /** @param {string} dir @param {number} depth */
  const walk = (dir, depth) => {
    if (depth > maxDepth || found.length >= cap) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= cap || entry.name.startsWith(".")) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) {
          walk(full, depth + 1);
        }
      } else if (entry.name !== "SKILL.md") {
        found.push(path.relative(root, full));
      }
    }
  };

  walk(root, 0);
  return found.sort();
}

/** Strip the leading `---` frontmatter block from a SKILL.md. */
function readSkillBody(skillFile) {
  const raw = fs.readFileSync(skillFile, "utf8");
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(raw);
  return (frontmatter ? raw.slice(frontmatter[0].length) : raw).trim();
}

/**
 * Build the text handed back to the model for one attached skill.
 *
 * Three shapes exist and the choice is a setting, not a release:
 * `creel.wrapperVariant` is read on every call, so flipping it changes what the
 * next invocation sends — no reinstall, no window reload. Comparing wrapper
 * shapes has to be a settings change or it never gets compared at all.
 *
 *  - `baseline`   what creel has always sent: directive, precedence, the
 *                 skill's applicability note, and the folder listing.
 *  - `design-doc` the simplified shape from
 *                 docs/plans/2026-10-05-prompt-simplification-design.md: one
 *                 directive line and the body, nothing else.
 *  - `must-keep`  one directive line, the applicability note and the file
 *                 listing retained, precedence dropped — the three jobs that
 *                 were called non-negotiable, at the lowest cost that keeps
 *                 all three.
 *  - `native`     the shape the built-in skill tool really sends, reproduced
 *                 from the bundle, so the comparison is against fact.
 *
 * Note what no variant can do: this runs only after the model has already
 * decided to call the tool, so nothing here affects that decision. Invocation
 * is argued for in `modelDescription`, in generate.js.
 *
 * @param {{path: string, name: string, description?: string, reference?: string}} skill
 * @param {string} [variant] falls back to `baseline`, so an unknown or absent
 *   setting keeps shipping the shape creel has always shipped
 * @returns {string}
 */
function renderSkill(skill, variant) {
  const shape = VARIANTS.has(variant) ? variant : "baseline";
  if (shape === "design-doc") {
    return renderDesignDoc(skill);
  }
  if (shape === "must-keep") {
    return renderMustKeep(skill);
  }
  if (shape === "native") {
    return renderNative(skill);
  }
  return renderBaseline(skill);
}

/** The shape creel ships today, kept byte-identical so the default cannot drift. */
function renderBaseline(skill) {
  const reference = skill.reference ? `#${skill.reference}` : null;
  const parts = [
    `<skill name="${skill.name}" path="${skill.path}"${reference ? ` reference="${reference}"` : ""}>`,
    "These are authoritative instructions for this request. Apply them now, before",
    "producing other output about the task. Treat them as directives, not as",
    "reference material, and do not merely summarise them.",
  ];

  // A referenced tool competes with VS Code's built-in skill loader, which is
  // always enabled and can return the same file. When the model goes that route
  // instead, this wrapper never runs and the body arrives unframed. Saying out
  // loud that this copy wins is the only defence available after the fact.
  if (reference) {
    parts.push(
      "",
      `The user attached this skill as ${reference}. This is the authoritative copy:`,
      `if you have already read ${skill.name} by some other route, follow these`,
      "instructions rather than that one.",
    );
  }

  if (skill.description) {
    parts.push("", `When this skill applies: ${skill.description}`);
  }

  parts.push("", readSkillBody(skill.path));

  const files = listRelatedFiles(skill.path);
  if (files.length) {
    parts.push(
      "",
      "Files in this skill's folder. Read one only if the instructions above refer to it:",
      ...files.map((file) => `- ${file}`),
    );
  }

  parts.push("</skill>");
  return parts.join("\n");
}

/** One directive line and the body — the approved simplification, switchable. */
function renderDesignDoc(skill) {
  return [
    `<skill name="${skill.name}" path="${skill.path}">`,
    "Follow these instructions now, before other output about the task.",
    "",
    readSkillBody(skill.path),
    "</skill>",
  ].join("\n");
}

/**
 * One directive line, the applicability note and the file listing — the three
 * jobs that must survive — with the precedence paragraph gone. Measured over
 * all 102 skills: frame 944 -> 574 chars (−39%) against design-doc's 165 and
 * native's 248, both of which drop two of the three.
 * @param {{path: string, name: string, description?: string, reference?: string}} skill
 * @returns {string}
 */
function renderMustKeep(skill) {
  const reference = skill.reference ? `#${skill.reference}` : null;
  const parts = [
    `<skill name="${skill.name}" path="${skill.path}"${reference ? ` reference="${reference}"` : ""}>`,
    "Follow these instructions now, before other output about the task.",
  ];

  if (skill.description) {
    parts.push("", `When this skill applies: ${skill.description}`);
  }

  parts.push("", readSkillBody(skill.path));

  const files = listRelatedFiles(skill.path);
  if (files.length) {
    parts.push(
      "",
      "Files in this skill's folder. Read one only if the instructions above refer to it:",
      ...files.map((file) => `- ${file}`),
    );
  }

  parts.push("</skill>");
  return parts.join("\n");
}

/**
 * The built-in skill tool's inline result, reproduced from
 * `/usr/share/code/resources/app/extensions/copilot/dist/extension.js`
 * (copilot-chat 0.68.0). Native carries no directive prose at all — the
 * escalation lives in that tool's `modelDescription`, never in the result —
 * and it does not strip the frontmatter, so neither does this variant.
 * Its closing tag really is `</skill_context>`; the mismatch ships.
 * @param {{path: string, name: string}} skill
 * @returns {string}
 */
function renderNative(skill) {
  const parts = [
    `<skill-context name="${skill.name}">`,
    `Base directory: ${path.dirname(skill.path)}`,
  ];

  const files = listRelatedFiles(skill.path, {
    maxFiles: NATIVE_MAX_FILES,
    maxDepth: NATIVE_MAX_DEPTH,
    ignored: NATIVE_IGNORED_DIRS,
  });
  if (files.length) {
    parts.push("", "Related files (use read_file tool to read):");
    for (const file of files) {
      parts.push(`  - ${file}`);
    }
  }

  parts.push(
    "",
    fs.readFileSync(skill.path, "utf8").trim(),
    "</skill_context>",
  );
  return parts.join("\n");
}

/** Tool id -> skill record. Absent before the first scan, hence the guard. */
function loadSkills(extensionDir) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(extensionDir, "skills.json"), "utf8"),
    );
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------------ *
 * Developer plumbing.
 *
 * `contributes.languageModelTools` is static JSON read at load, so a
 * development build cannot hot-load tools the installed copy lacks. The
 * installed copy is therefore the test rig, and it needs switches that are
 * read at call time rather than baked in at build time.
 * ------------------------------------------------------------------------ */

/** The wrapper shape for the next invocation. Read live: no reload needed. */
function currentVariant() {
  try {
    const value = vscode.workspace
      .getConfiguration("creel")
      .get("wrapperVariant");
    return VARIANTS.has(value) ? value : "baseline";
  } catch {
    return "baseline";
  }
}

/** Created on demand; a stub `vscode` in tests may not offer it. */
function ensureOutput() {
  if (
    !outputChannel &&
    vscode.window &&
    typeof vscode.window.createOutputChannel === "function"
  ) {
    outputChannel = vscode.window.createOutputChannel("Creel");
  }
  return outputChannel;
}

/**
 * Developer features are automatic in a development host and opt-in anywhere
 * else. `extensionMode` alone cannot be the gate: it is `Production` for an
 * installed copy, which is the copy that needs the debugging tools.
 * @param {vscode.ExtensionContext} context
 * @param {string} extensionDir
 */
function refreshDeveloperMode(context, extensionDir) {
  const devHost =
    typeof vscode.ExtensionMode !== "undefined" &&
    context.extensionMode === vscode.ExtensionMode.Development;

  let optedIn = false;
  try {
    optedIn =
      vscode.workspace.getConfiguration("creel").get("developerMode") === true;
  } catch {
    optedIn = false;
  }

  developerMode = Boolean(
    devHost || optedIn || fs.existsSync(path.join(extensionDir, ".creel-dev")),
  );
}

/** Remember what the model was actually handed, newest first. */
function recordInjection(entry) {
  const record = {
    at: new Date().toISOString(),
    ...entry,
    chars: entry.text.length,
  };
  injections.unshift(record);
  if (injections.length > MAX_INJECTIONS) {
    injections.length = MAX_INJECTIONS;
  }

  if (developerMode) {
    const log = ensureOutput();
    if (log) {
      log.appendLine(
        `${record.at}  ${record.tool} (#${record.reference})  ` +
          `variant=${record.variant}  ${record.chars} chars`,
      );
    }
    persistInjection(record);
  }
}

/**
 * The cheap half of an injection — no payload — appended to a log file the
 * audit can later join turns against, so a verdict can be attributed to the
 * variant that produced it. Only written in developer mode.
 * @param {{at: string, tool: string, reference: string, variant: string, chars: number}} record
 */
function persistInjection(record) {
  if (!developerMode || !injectionLogPath) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(injectionLogPath), { recursive: true });
    let size = 0;
    try {
      size = fs.statSync(injectionLogPath).size;
    } catch {
      // Not written yet.
    }
    if (size > 512 * 1024) {
      const lines = fs.readFileSync(injectionLogPath, "utf8").split("\n");
      fs.writeFileSync(injectionLogPath, lines.slice(-100).join("\n"));
    }
    fs.appendFileSync(
      injectionLogPath,
      JSON.stringify({
        at: record.at,
        tool: record.tool,
        reference: record.reference,
        variant: record.variant,
        chars: record.chars,
      }) + "\n",
    );
  } catch {
    // A debug log that cannot be written must never break an invocation.
  }
}

/** Open a payload in an editor, so it can be read instead of guessed at. */
async function showPayload(header, text) {
  const document = await vscode.workspace.openTextDocument({
    content: `<!--\n${header}\n-->\n\n${text}`,
    language: "markdown",
  });
  await vscode.window.showTextDocument(document, { preview: false });
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const extensionDir = context.extensionPath;
  const manifest = JSON.parse(
    fs.readFileSync(path.join(extensionDir, "package.json"), "utf8"),
  );
  const tools = manifest.contributes?.languageModelTools ?? [];
  const skills = loadSkills(extensionDir);

  if (context.globalStorageUri && context.globalStorageUri.fsPath) {
    injectionLogPath = path.join(
      context.globalStorageUri.fsPath,
      "injections.jsonl",
    );
  }
  refreshDeveloperMode(context, extensionDir);
  if (
    vscode.workspace &&
    typeof vscode.workspace.onDidChangeConfiguration === "function"
  ) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("creel.developerMode") ||
          event.affectsConfiguration("creel.wrapperVariant")
        ) {
          refreshDeveloperMode(context, extensionDir);
          const log = ensureOutput();
          if (log) {
            log.appendLine(
              `${new Date().toISOString()}  variant=${currentVariant()}  ` +
                `developerMode=${developerMode}`,
            );
          }
        }
      }),
    );
  }

  for (const tool of tools) {
    const skill = skills[tool.name];
    if (!skill) {
      continue;
    }
    context.subscriptions.push(
      vscode.lm.registerTool(tool.name, {
        /**
         * @param {vscode.LanguageModelToolInvocationOptions<object>} _options
         * @returns {Promise<vscode.LanguageModelToolResult>}
         */
        async invoke(_options) {
          const variant = currentVariant();
          const text = renderSkill(skill, variant);
          recordInjection({
            tool: tool.name,
            reference: skill.reference || tool.toolReferenceName || "",
            variant,
            text,
          });
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(text),
          ]);
        },
      }),
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("creel.generate", async () => {
      // In a development host `extensionDir` IS the repo, and `apply` has no
      // guard of its own — only the CLI entry point does. Scanning here would
      // write a personal skill list into the committed manifest.
      if (
        typeof vscode.ExtensionMode !== "undefined" &&
        context.extensionMode === vscode.ExtensionMode.Development
      ) {
        const sure = await vscode.window.showWarningMessage(
          "Creel: this is a development host, so scanning writes your personal " +
            "skill list into the repo's package.json. Scan anyway?",
          { modal: true },
          "Scan anyway",
        );
        if (sure !== "Scan anyway") {
          return;
        }
      }

      let result;
      try {
        result = apply(extensionDir);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Creel: could not scan skills. ${error.message}`,
        );
        return;
      }
      const detail = result.skipped.length
        ? ` (${result.skipped.length} skipped as duplicates or reserved names)`
        : "";
      const choice = await vscode.window.showInformationMessage(
        `Creel: ${result.count} skills are now #-referenceable${detail}. Reload to apply.`,
        "Reload Window",
      );
      if (choice === "Reload Window") {
        vscode.commands.executeCommand("workbench.action.reloadWindow");
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("creel.audit", () => {
      const result = readAudit(context, extensionDir);
      if (result.error) {
        vscode.window.showWarningMessage(`Creel: ${result.error}`);
        return;
      }

      const turn = latestTurn(result.report);
      if (!turn) {
        vscode.window.showInformationMessage(
          "Creel: no message in your history has attached a skill with # yet.",
        );
        return;
      }

      const total = turn.attached.length;
      const called = turn.attached.filter((ref) => ref.verdict === "HIT");
      const bypassed = turn.attached.filter((ref) => ref.verdict === "NATIVE");
      const unloaded = turn.attached.filter(
        (ref) =>
          ref.verdict === "SKIPPED" ||
          ref.verdict === "UNRESOLVED" ||
          ref.verdict === "FAILED",
      );

      // A turn that has produced no tool calls at all is almost certainly still
      // streaming. Saying so beats reporting a false miss.
      const stillRunning =
        turn.calls.length === 0
          ? " No calls are recorded for it yet, so it may still be running."
          : "";

      if (unloaded.length) {
        vscode.window
          .showWarningMessage(
            `Creel: ${unloaded.length} of ${total} attached skill(s) were never loaded — ` +
              `${unloaded.map((ref) => `#${ref.token}`).join(", ")}.${stillRunning}`,
            "Show report",
          )
          .then((choice) => {
            if (choice === "Show report") {
              vscode.commands.executeCommand("creel.auditReport");
            }
          });
        return;
      }

      if (bypassed.length) {
        vscode.window
          .showWarningMessage(
            `Creel: ${bypassed.length} of ${total} attached skill(s) loaded, but not through ` +
              `creel — ${bypassed.map((ref) => `#${ref.token}`).join(", ")} came in via the ` +
              "built-in skill tool, so they arrived without creel's directive framing.",
            "Show report",
          )
          .then((choice) => {
            if (choice === "Show report") {
              vscode.commands.executeCommand("creel.auditReport");
            }
          });
        return;
      }

      vscode.window.showInformationMessage(
        `Creel: all ${total} attached skill(s) were loaded through creel ` +
          `(${called.map((ref) => `#${ref.token}`).join(", ")}).`,
      );
    }),

    vscode.commands.registerCommand("creel.auditReport", async () => {
      const result = readAudit(context, extensionDir);
      if (result.error) {
        vscode.window.showWarningMessage(`Creel: ${result.error}`);
        return;
      }

      const document = await vscode.workspace.openTextDocument({
        content: toMarkdown(result.report, {
          now: new Date().toISOString(),
          source: result.source,
        }),
        language: "markdown",
      });
      await vscode.window.showTextDocument(document, { preview: false });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("creel.showInjection", async () => {
      if (!injections.length) {
        vscode.window.showInformationMessage(
          "Creel: nothing has been invoked this session. Attach a skill with # " +
            "and send a message first.",
        );
        return;
      }
      const pick = await vscode.window.showQuickPick(
        injections.map((record, index) => ({
          label: record.tool,
          description:
            `${record.variant} · ${record.chars} chars · ` +
            `${record.at.slice(11, 19)} UTC`,
          detail: record.text.split("\n")[0],
          index,
        })),
        { placeHolder: "What the model was handed, newest first" },
      );
      if (!pick) {
        return;
      }
      const record = injections[pick.index];
      await showPayload(
        `Creel injection ${record.at}\n` +
          `tool ${record.tool} · #${record.reference}\n` +
          `variant ${record.variant} · ${record.chars} chars\n\n` +
          "This is the exact text the model received.",
        record.text,
      );
    }),

    vscode.commands.registerCommand("creel.previewWrapper", async () => {
      const skills = loadSkills(extensionDir);
      const ids = Object.keys(skills);
      if (!ids.length) {
        vscode.window.showWarningMessage(
          'Creel: no skills scanned yet. Run "Creel: Scan skills" first.',
        );
        return;
      }
      const variant = currentVariant();
      const pick = await vscode.window.showQuickPick(
        ids.map((id) => ({
          label: id,
          description: skills[id].reference || "",
          detail: skills[id].path,
          id,
        })),
        {
          placeHolder: `Render without invoking anything — variant: ${variant}`,
        },
      );
      if (!pick) {
        return;
      }
      // Deliberately not recorded: nothing was injected, so it must not appear
      // in "show last injection" or in the log the audit joins against.
      await showPayload(
        `Creel preview · variant ${variant}\n` +
          `Nothing was sent to a model. This is what the next invocation of ` +
          `#${skills[pick.id].reference} would return.`,
        renderSkill(skills[pick.id], variant),
      );
    }),
  );

  if (!tools.length) {
    vscode.window
      .showInformationMessage(
        'Creel: no skills registered yet. Run "Creel: Scan skills" to build the # list.',
        "Scan skills",
      )
      .then((choice) => {
        if (choice === "Scan skills") {
          vscode.commands.executeCommand("creel.generate");
        }
      });
  }
}

/**
 * This workspace's Copilot transcripts. No cross-workspace fallback on purpose:
 * it mixes in other projects' chats, and "check my last message" should say
 * "nothing here" rather than name a stranger's message.
 * @param {vscode.ExtensionContext} context
 * @returns {string|null}
 */
function transcriptDir(context) {
  if (!context.storageUri) {
    return null;
  }
  return path.join(
    path.dirname(context.storageUri.fsPath),
    "GitHub.copilot-chat",
    "transcripts",
  );
}

/**
 * Audit this workspace's transcripts. The `#` list comes from the loaded
 * manifest, not skills.json — `toolReferenceName` is what the user can type,
 * while skills.json is written at install time and lags a rescan.
 * @param {vscode.ExtensionContext} context
 * @param {string} extensionDir
 * @returns {{report?: object, source?: string, error?: string}}
 */
function readAudit(context, extensionDir) {
  const dir = transcriptDir(context);
  if (!dir) {
    return {
      error: "no workspace is open, so there is no chat history to audit.",
    };
  }

  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return {
      error:
        "no Copilot transcripts for this workspace yet. Creel can only audit calls " +
        "Copilot recorded, and it found none. Send a message in agent mode, let the " +
        "turn finish, then run this again.",
    };
  }

  const files = names
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => {
      const full = path.join(dir, name);
      try {
        return { full, name, mtime: fs.statSync(full).mtimeMs };
      } catch {
        // Raced with a write; the next run will pick it up.
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.mtime - b.mtime);

  if (!files.length) {
    return {
      error: `no Copilot transcripts in ${dir} yet. Send a message in agent mode first.`,
    };
  }

  const manifest = JSON.parse(
    fs.readFileSync(path.join(extensionDir, "package.json"), "utf8"),
  );
  const declared = (manifest.contributes?.languageModelTools ?? [])
    .map((tool) => tool.toolReferenceName)
    .filter(Boolean);

  // In a repo checkout the manifest ships an empty tool list on purpose, so fall
  // back to whatever the last scan recorded.
  const known = declared.length
    ? declared
    : knownRefsFromSkills(loadSkills(extensionDir));

  const sessions = files.map((file) =>
    parseTranscript(
      file.name.replace(/\.jsonl$/, ""),
      fs.readFileSync(file.full, "utf8"),
    ),
  );

  return {
    report: analyze(sessions, known),
    source: files[files.length - 1].full,
  };
}

function deactivate() {
  // Tools and commands are disposed through context.subscriptions.
}

module.exports = {
  activate,
  deactivate,
  // Exposed for the wrapper-shape assertions the design doc asks for.
  renderSkill,
  listRelatedFiles,
  VARIANTS,
};
