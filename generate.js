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
 * What the loader's index may spend, in characters, when `creel.indexBudget` is
 * unset.
 *
 * The index is the only place the model learns a skill exists, so it is the one
 * surface worth paying for — but it is paid on every request. Measured on
 * 2026-10-25 across the then-141 skills:
 *
 *   every name, no trigger .........  3,079 bytes ≈ 0.9k tokens
 *   every name + a 90-char trigger . 12,956 bytes ≈ 3.6k tokens (this default)
 *   141 tools instead .............. 21,184 bytes ≈ 5.9k tokens, of which
 *                                    18,441 bytes are per-skill schemas that say
 *                                    nothing but `Load the "x" skill.`
 *
 * So the default is a third cheaper than the surface it replaced *and* carries
 * the trigger words that surface threw away; dropping the budget to 0 makes it
 * six times cheaper. Lower it to buy tokens back at the price of trigger
 * coverage; at 0 the index is names only and every skill is still loadable,
 * just not selectable from the text alone.
 */
const LOADER_INDEX_BUDGET = 12000;

/** Longest trigger phrase per skill, before its line is trimmed to fit. */
const INDEX_TRIGGER_MAX = 90;

/**
 * The most `#` tools creel will emit, whatever the preset says.
 *
 * `hotSkills: ["*"]` — what preset `all` expands to — names every skill, and
 * 142 tools is how the request got past the ceiling where the client stops
 * making creel's tools available at all. Measured on 2026-10-28: ~28 of them
 * reached the model, and every call past that slice came back `success:false`
 * with no execution behind it (the audit's "called but never ran" rows). A `#`
 * beyond the slice is worse than no `#`: the picker offers it, the call dies.
 *
 * So the surface degrades by usage instead of by name. Everything cut here is
 * still reachable through the loader, which is the one tool that always
 * survives. 20 is `creel.hotCount`'s own default, so this adds no new number.
 * ponytail: fixed ceiling, raise it if the client's limit moves.
 */
const MAX_HOT_TOOLS = 20;

/**
 * The loader's index: one line per skill, the richest shape that fits.
 *
 * Degradation is per line, not global. A skill whose line no longer fits falls
 * back to its bare name rather than being dropped — a name is enough for the
 * model to call the tool, while a missing skill is not findable at all. That is
 * the difference between this index and VS Code's own `<skills>` block, which
 * truncates to names with no `<file>` and then cannot resolve them.
 *
 * Trigger text is the skill's own description, capped. It is the only phrasing
 * anyone has, and it is written for exactly this job.
 *
 * @param {Array<{name?: string, description?: string}>} skills
 * @param {number} [budget] characters the trigger text may spend
 * @returns {{text: string, withTrigger: number, bare: number, chars: number}}
 */
function buildIndex(skills, budget = LOADER_INDEX_BUDGET) {
  const sorted = [...skills].sort((a, b) =>
    (a.name || "").localeCompare(b.name || ""),
  );
  const lines = [];
  let used = 0;
  let withTrigger = 0;
  let bare = 0;

  for (const skill of sorted) {
    if (!skill.name) continue;
    const trigger = cap(oneLine(skill.description || ""), INDEX_TRIGGER_MAX);
    const rich = trigger ? `- ${skill.name} — ${trigger}` : `- ${skill.name}`;
    const poor = `- ${skill.name}`;
    const fits = used + rich.length + 1 <= budget;
    const line = fits ? rich : poor;
    if (fits && trigger) withTrigger += 1;
    else bare += 1;
    used += line.length + 1;
    lines.push(line);
  }

  return { text: lines.join("\n"), withTrigger, bare, chars: used };
}

/**
 * The loader's manifest entry — one tool for the whole library.
 *
 * `canBeReferencedInPrompt: false` is the whole point. A referenceable tool is
 * an attachment: VS Code forces the call once the user types `#`, but the model
 * never sees it before that, so it cannot decide a skill applies and fetch it.
 * This one sits in the tool list permanently, and it is also the only route into
 * skills carrying `disable-model-invocation: true`.
 *
 * It used to be one of 142 entries, with 141 siblings that each carried nothing
 * but a name in their description. Those are gone: a per-skill tool bought
 * ~180 bytes of schema and no semantics, and 141 of them pushed the request
 * past the ceiling where the client stops making tools available at all — which
 * is why three skills in one message came back as `success:false` with no
 * execution behind them. Trigger words live here now, where they cost the same
 * bytes and are attached to a tool that cannot be evicted.
 *
 * @param {{text?: string}} index from {@link buildIndex}
 * @param {{total?: number}} [options] how many skills were scanned, so an empty
 *   index can be described accurately — it means "every one of them already has
 *   its own tool", not "nothing was found"
 * @returns {object} a `contributes.languageModelTools` entry
 */
function loaderEntry(index, options = {}) {
  const text = (index && index.text) || "";
  const total = Number.isFinite(options.total) ? options.total : null;
  let tail;
  if (text) {
    tail = `\n\nAvailable skills, one per line as \`- name — when to use it\`:\n${text}`;
  } else if (total) {
    // No count here on purpose: `total` counts scanned paths, and two folders
    // holding the same skill name collapse to one tool, so the two numbers can
    // differ by one and a precise-looking figure would be wrong.
    tail =
      "\n\nEvery scanned skill already has its own tool. Use this one only to reach a skill by name when that tool is not in the list.";
  } else {
    tail = "\n\nNo skills have been scanned yet.";
  }
  return {
    name: LOADER_NAME,
    displayName: "Load skill",
    userDescription: "Load one of the skills Creel has scanned.",
    modelDescription:
      "Load a skill's instructions by name, then follow them before continuing " +
      'with the task. Input: {"skill": "<name>"}. The name is the skill\'s own ' +
      "name, not a # reference." +
      tail,
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
 * What a tool list costs the model, in the shape VS Code actually forwards:
 * name, description and JSON schema. Measured, not estimated — the loader shape
 * exists on the claim that this number went down, so the scan reports it.
 *
 * @param {object[]} tools `contributes.languageModelTools`
 * @returns {{tools: number, bytes: number, tokens: number}}
 */
function surfaceCost(tools) {
  const bytes = (tools || []).reduce(
    (total, tool) =>
      total +
      JSON.stringify({
        name: tool.name,
        description: tool.modelDescription || tool.userDescription || "",
        parameters: tool.inputSchema,
      }).length,
    0,
  );
  // ~3.6 bytes per token is the ratio measured on these manifests; it is a
  // guide for the report, never a budget input.
  return { tools: (tools || []).length, bytes, tokens: Math.round(bytes / 3.6) };
}

/**
 * Where VS Code keeps per-workspace chat transcripts.
 *
 * Machine-wide on purpose: the answer to "which skills do I actually attach"
 * lives across every repo, not in whichever window happened to be open when the
 * scan ran. Override with `CREEL_TRANSCRIPTS_DIR`, which is also how the test
 * suite avoids reading real chats.
 *
 * @returns {string}
 */
function transcriptRoot() {
  return process.env.CREEL_TRANSCRIPTS_DIR
    ? process.env.CREEL_TRANSCRIPTS_DIR
    : path.join(os.homedir(), ".config/Code/User/workspaceStorage");
}

/**
 * Every `.jsonl` under `root`, oldest last.
 *
 * Two shapes appear in practice and both are handled: the real layout
 * `<workspaceStorage>/<hash>/GitHub.copilot-chat/transcripts/*.jsonl`, and a
 * flat folder of transcripts, which keeps fixtures honest without mirroring four
 * directory levels in a temp dir. Unreadable folders are skipped, never thrown.
 *
 * Sorted newest first and capped, because this corpus is not small — 375 files
 * and 279 MB on the machine this was written on, where reading all of it took 37
 * seconds. Usage ranking does not need the whole archive: the last few dozen
 * megabytes describe the same habits.
 *
 * @param {string} root
 * @returns {string[]} absolute paths, newest first
 */
function transcriptFiles(root) {
  const found = [];
  const MAX_DEPTH = 4;
  const MAX_FILES = 5000;

  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH || found.length >= MAX_FILES) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // a missing or unreadable store is not an error
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name.endsWith(".jsonl")) found.push(full);
    }
  };

  walk(root, 0);

  return found
    .map((file) => {
      try {
        return { file, mtime: fs.statSync(file).mtimeMs };
      } catch {
        return { file, mtime: 0 };
      }
    })
    .sort((a, b) => b.mtime - a.mtime)
    .map((entry) => entry.file);
}

/** Bytes of chat history {@link usageCounts} will read before it stops. */
const USAGE_READ_BUDGET = 64 * 1024 * 1024;

/** Lines that can carry a skill signal, used to skip parsing the rest. */
const USAGE_LINE_MARKERS = [
  '"user.message"',
  '"toolRequests"',
  '"tool.execution_start"',
];

/**
 * How often each skill was attached or loaded, counted from transcripts.
 *
 * Three signals, because a skill can arrive three ways and each is evidence the
 * skill is wanted: a `#skill-x` typed in a message, a creel `skill-x` tool call,
 * and the built-in `skill` tool called with `{"skill":"x"}`. Tokens are resolved
 * through an alias map (tool id, `#` reference, frontmatter name, folder name)
 * so all three land on one skill.
 *
 * A transcript records no model and no error text, which does not matter here:
 * the question is only what you reached for, not whether it worked.
 *
 * @param {string} root transcript dir, nested or flat
 * @param {Map<string, string>} byAlias lowercase alias -> skill name
 * @returns {Map<string, number>} skill name -> count
 */
function usageCounts(root, byAlias) {
  const counts = new Map();
  const note = (token) => {
    const name = byAlias.get(String(token ?? "").trim().toLowerCase());
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  };

  let budget = USAGE_READ_BUDGET;
  for (const file of transcriptFiles(root)) {
    if (budget <= 0) break;
    let raw;
    try {
      budget -= fs.statSync(file).size;
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      // Most lines are small events that cannot carry a skill. Checking for the
      // three event shapes first keeps JSON.parse off roughly 95% of them, which
      // is the difference between seconds and half a minute on a large archive.
      if (!USAGE_LINE_MARKERS.some((marker) => line.includes(marker))) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const data = event.data || {};
      if (event.type === "user.message") {
        // `#skill-tdd` typed into the box, which survives as plain text.
        for (const match of String(data.content || "").matchAll(/#([\w-]+)/g)) {
          note(match[1]);
        }
      } else if (event.type === "assistant.message") {
        for (const request of data.toolRequests || []) {
          note(request.name);
          if (request.name === "skill") {
            try {
              note(JSON.parse(request.arguments || "{}").skill);
            } catch {
              // a malformed argument is not a usage signal
            }
          }
        }
      } else if (event.type === "tool.execution_start") {
        if (data.toolName === "skill") note((data.arguments || {}).skill);
        else note(data.toolName);
      }
    }
  }

  return counts;
}

/**
 * Which skills earn a `#` tool of their own.
 *
 * `#name` resolves only to a tool with that `toolReferenceName` — VS Code's
 * parser has no skill branch — so every `#` costs a tool slot in a request whose
 * ceiling is 128 entries before the client starts withholding tools. One per
 * skill cannot be the answer; a bounded set can, and the boundary should come
 * from evidence rather than from the alphabet.
 *
 * `creel.hotSkills` wins outright when set, so the list can be pinned. Otherwise
 * the top `count` by measured usage. A skill that has never been used never
 * appears here, which is the point.
 *
 * @param {Record<string, {name?: string, reference?: string, path?: string}>} paths
 * @param {{explicit?: string[], count?: number, root?: string}} [options]
 * @returns {{names: string[], source: string, counts: Map<string, number>}}
 */
function hotSet(paths, options = {}) {
  const explicit = Array.isArray(options.explicit) ? options.explicit : [];
  const count = Number.isFinite(options.count) ? options.count : 20;

  const byAlias = new Map();
  const known = new Set();
  for (const [id, skill] of Object.entries(paths || {})) {
    const name = skill.name || id;
    known.add(name);
    const aliases = [
      id,
      skill.reference,
      name,
      skill.path ? path.basename(path.dirname(skill.path)) : "",
    ];
    for (const alias of aliases) {
      if (alias) byAlias.set(String(alias).toLowerCase(), name);
    }
  }

  if (explicit.length) {
    // `["*"]` means every skill — the one word for "give me all of them".
    if (explicit.some((name) => String(name).trim() === "*")) {
      // Ordered by usage, not alphabetically, because the trigger budget is
      // spent top-down: the skills you actually reach for should be the ones
      // that keep a trigger when there are too many to give them all one.
      const counts = usageCounts(options.root || transcriptRoot(), byAlias);
      const names = [...known].sort(
        (a, b) => (counts.get(b) || 0) - (counts.get(a) || 0) || a.localeCompare(b),
      );
      return { names, source: "setting (all)", counts };
    }
    const names = [];
    for (const raw of explicit) {
      const name = byAlias.get(String(raw).trim().toLowerCase()) || raw;
      if (known.has(name) && !names.includes(name)) names.push(name);
    }
    return { names, source: "setting", counts: new Map() };
  }

  if (!count) return { names: [], source: "off", counts: new Map() };

  const counts = usageCounts(options.root || transcriptRoot(), byAlias);
  const names = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([name]) => name);
  return { names, source: "transcripts", counts };
}

/**
 * The three combinations worth naming, so the common choices are one dropdown
 * instead of two settings that only make sense together.
 *
 * `all` is the one that needs explaining: every skill asks for a `#` tool, the
 * most-used `MAX_HOT_TOOLS` get one, and the rest fall into the index — which
 * keeps its budget, because those skills no longer have a tool name to serve as
 * their index. It used to zero the budget on the theory that the tool names
 * *were* the index, true only while every skill had a tool.
 *
 * `custom` is the default and means "use `creel.hotSkills`, `creel.hotCount` and
 * `creel.indexBudget` exactly as written".
 */
const PRESETS = {
  custom: {},
  // Each preset names all three keys, including the empty ones. Merging over the
  // user's settings would let a pinned `hotSkills` list leak into `balanced` and
  // make the preset mean something different per machine.
  balanced: { hotSkills: [], hotCount: 20, indexBudget: 12000 },
  all: { hotSkills: ["*"], hotCount: 0, indexBudget: 12000 },
  loader: { hotSkills: [], hotCount: 0, indexBudget: 12000 },
};

/**
 * Replace the per-setting values with a preset's, when one is chosen.
 *
 * A preset wins outright rather than merging, because a half-applied preset is
 * the state nobody can reason about: `all` with the old `hotCount` still set
 * would give a `#` tool for every skill *and* leave the index paying for
 * triggers. Returning the preset name keeps the scan able to say which one ran.
 *
 * @param {Record<string, unknown>} settings
 * @returns {{settings: Record<string, unknown>, preset: string}}
 */
function applyPreset(settings) {
  const name = typeof settings.preset === "string" ? settings.preset : "";
  const preset = PRESETS[name];
  if (!preset) return { settings, preset: "custom" };
  return { settings: { ...settings, ...preset }, preset: name };
}

/**
 * A `#` tool's standing text: the skill's name and its trigger.
 *
 * The trigger is deliberate. A referenceable tool is in the standing tool list
 * whether or not anything is attached, so a hot skill is also one the model can
 * pick on its own — and it should be able to tell when. This is the same text
 * the loader index would have carried, which is why the index omits hot skills
 * instead of paying for them twice.
 *
 * @param {{name: string, description?: string}} skill
 * @returns {string}
 */
function hotDescription(skill) {
  // Descriptions usually end in a full stop; dropping it avoids `..` when the
  // sentence here adds its own.
  const trigger = cap(oneLine(skill.description || ""), INDEX_TRIGGER_MAX).replace(
    /\.+$/,
    "",
  );
  return `Load the "${skill.name}" skill${trigger ? ` — ${trigger}` : ""}.`;
}

/**
 * Write the manifest and the id -> path map next to this file.
 *
 * `creel.toolSurface` decides the shape:
 *
 *  - `loader` (default) one tool for the whole library, plus one `#` tool for
 *    each skill in the hot set. Every skill is findable by name; the ones you
 *    actually use are also attachable by `#`.
 *  - `tools`  the legacy one-tool-per-skill surface, kept because a comparison
 *    needs both arms. Costs ~5.9k tokens and is what put the request over the
 *    client's tool ceiling.
 *
 * @param {string} extensionDir the extension's own folder
 * @param {Record<string, unknown>} [overrides] settings to use instead of the
 *   extension host's — the CLI passes the user's `settings.json` here, because
 *   `require("vscode")` throws outside the host and a CLI scan would otherwise
 *   silently ignore every `creel.*` setting and produce a different manifest
 *   from the same install
 * @returns {{count: number, skipped: string[], surface: string, cost: object, index: object, hot: object}}
 */
function apply(extensionDir, overrides = {}) {
  const manifestPath = path.join(extensionDir, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const settings = {};
  try {
    settings.prefix = readConfiguredPrefix();
    settings.folders = readConfiguredFolders();
    settings.variant = readConfiguredVariant();
    settings.surface = readConfiguredToolSurface();
    settings.indexBudget = readConfiguredIndexBudget();
    settings.hotSkills = readConfiguredHotSkills();
    settings.hotCount = readConfiguredHotCount();
    settings.preset = readConfiguredPreset();
  } catch {
    // Settings are unavailable outside the extension host; use defaults.
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) settings[key] = value;
  }

  const { settings: resolved, preset } = applyPreset(settings);
  const prefix = resolved.prefix ?? "skill-";
  const variant = resolved.variant ?? "must-keep";
  const surface = resolved.surface === "tools" ? "tools" : "loader";
  const configured =
    Number.isFinite(resolved.indexBudget) && resolved.indexBudget >= 0
      ? resolved.indexBudget
      : LOADER_INDEX_BUDGET;
  // In `tools` mode every skill already has a tool whose name is the index, so
  // trigger text there would be bought twice. Names only, which keeps the legacy
  // arm at the cost it has today instead of quietly raising it.
  const budget = surface === "tools" ? 0 : configured;
  const folders = resolved.folders ?? [
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

  // Which skills get a `#` tool of their own. Computed before the index so the
  // index can leave them out — a hot skill already carries its trigger in the
  // standing tool list, and paying for it twice is how the bill got to 5.9k.
  const hot = hotSet(paths, {
    explicit: resolved.hotSkills,
    count: resolved.hotCount,
  });

  const idByName = new Map();
  for (const [id, skill] of Object.entries(paths)) {
    if (skill.name && !idByName.has(skill.name)) idByName.set(skill.name, id);
  }
  const toolById = new Map(tools.map((tool) => [tool.name, tool]));
  // One trigger budget, spent in rank order: hot skills first because they are
  // the ones most likely to be picked unprompted, then whatever is left goes to
  // the index. Without this the hot set could spend past `indexBudget` and the
  // number the setting advertises would stop being the number paid.
  // `hotSkills: ["*"]` (preset `all`) can name every skill. Only the most-used
  // MAX_HOT_TOOLS get a tool of their own; the cap is why they exist at all.
  const hotNames = hot.names.slice(0, MAX_HOT_TOOLS);
  let triggerBudget = budget;
  const hotTools = [];
  for (const name of hotNames) {
    const id = idByName.get(name);
    const tool = id ? toolById.get(id) : null;
    if (!tool) continue;
    const plain = `Load the "${name}" skill.`;
    const rich = hotDescription(paths[id]);
    const extra = rich.length - plain.length;
    const afford = extra > 0 && triggerBudget >= extra;
    if (afford) triggerBudget -= extra;
    hotTools.push({ ...tool, modelDescription: afford ? rich : plain });
  }

  // The index is built from skills.json rather than from `tools`, because in
  // `loader` mode there are no per-skill tools to read names off. Hot skills are
  // left out — their trigger already sits in the standing tool list — and the
  // index gets whatever the hot set could not afford.
  const rest = Object.values(paths).filter(
    (skill) => !hotNames.includes(skill.name),
  );
  const index = buildIndex(rest, Math.max(0, triggerBudget));

  // The loader is emitted only when there is something to load, so a scan that
  // finds nothing still leaves the manifest empty — which is how the extension
  // tells the user to scan in the first place.
  const loader = loaderEntry(index, { total: Object.keys(paths).length });
  const emitted = !Object.keys(paths).length
    ? []
    : surface === "tools"
      ? [loader, ...tools]
      : [loader, ...hotTools];

  manifest.contributes.languageModelTools = emitted;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");

  return {
    count: tools.length,
    skipped,
    surface,
    preset,
    cost: surfaceCost(emitted),
    index,
    hot: {
      names: hotNames,
      source: hot.source,
      counts: hotNames.map((name) => [name, hot.counts.get(name) || 0]),
    },
  };
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

/** Read `creel.toolSurface` if we are running inside VS Code. */
function readConfiguredToolSurface() {
  const vscode = require("vscode");
  return vscode.workspace.getConfiguration("creel").get("toolSurface");
}

/** Read `creel.indexBudget` if we are running inside VS Code. */
function readConfiguredIndexBudget() {
  const vscode = require("vscode");
  return vscode.workspace.getConfiguration("creel").get("indexBudget");
}

/** Read `creel.hotSkills` if we are running inside VS Code. */
function readConfiguredHotSkills() {
  const vscode = require("vscode");
  return vscode.workspace.getConfiguration("creel").get("hotSkills");
}

/** Read `creel.hotCount` if we are running inside VS Code. */
function readConfiguredHotCount() {
  const vscode = require("vscode");
  return vscode.workspace.getConfiguration("creel").get("hotCount");
}

/** Read `creel.preset` if we are running inside VS Code. */
function readConfiguredPreset() {
  const vscode = require("vscode");
  return vscode.workspace.getConfiguration("creel").get("preset");
}

/**
 * The `creel.*` settings as written on disk, for a scan run outside the host.
 *
 * A CLI scan and the **Creel: Scan skills** command must produce the same
 * manifest from the same install, and they only do if the CLI can see the
 * settings. VS Code's `settings.json` is JSONC, so comments and trailing commas
 * are removed before parsing. Anything unreadable yields nothing, which leaves
 * the defaults in place rather than failing a scan.
 *
 * @returns {Record<string, unknown>}
 */
function readUserSettings() {
  const file = path.join(os.homedir(), ".config/Code/User/settings.json");
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return {};
  }
  const jsonc = raw
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,(\s*[}\]])/g, "$1");
  let parsed;
  try {
    parsed = JSON.parse(jsonc);
  } catch {
    return {};
  }

  const out = {};
  const map = {
    "creel.referencePrefix": "prefix",
    "creel.skillFolders": "folders",
    "creel.wrapperVariant": "variant",
    "creel.toolSurface": "surface",
    "creel.indexBudget": "indexBudget",
    "creel.hotSkills": "hotSkills",
    "creel.hotCount": "hotCount",
    "creel.preset": "preset",
  };
  for (const [key, name] of Object.entries(map)) {
    if (parsed[key] !== undefined) out[name] = parsed[key];
  }
  return out;
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
  LOADER_INDEX_BUDGET,
  INDEX_TRIGGER_MAX,
  MAX_HOT_TOOLS,
  PRESETS,
  applyPreset,
  transcriptRoot,
  transcriptFiles,
  usageCounts,
  hotSet,
  hotDescription,
  readUserSettings,
  scanSkills,
  buildEntries,
  buildIndex,
  loaderEntry,
  surfaceCost,
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
        "  node ~/.vscode/extensions/michael-obele.creel-0.7.0/generate.js\n" +
        "Pass --force only if you really mean to commit a skill list.",
    );
    process.exit(1);
  }

  const { count, skipped, surface, preset, cost, index, hot } = apply(
    __dirname,
    readUserSettings(),
  );
  if (preset !== "custom") {
    console.log(`Creel: preset "${preset}" is in charge of the hot set and budget.`);
  }
  console.log(
    `Creel: ${count} skills reachable through ${LOADER_NAME} ` +
      `(${index.withTrigger} with a trigger line, ${index.bare} name only).`,
  );
  // A hot set can be every skill, and printing 140 names buries the numbers that
  // matter. Show the head of the ranked list and count the rest.
  const shown = hot.names.slice(0, 8);
  const more = hot.names.length - shown.length;
  const listed = shown
    .map((name, i) => (hot.counts[i][1] ? `${name}(${hot.counts[i][1]})` : name))
    .join(", ");
  console.log(
    `Creel: ${hot.names.length} skill(s) get a # reference, ` +
      `${hot.source === "transcripts" ? "chosen by how often you use them" : hot.source}` +
      (hot.names.length ? `: ${listed}${more > 0 ? `, … ${more} more` : ""}` : "."),
  );
  console.log(
    `Creel: tool surface = ${cost.tools} tool(s), ${cost.bytes} bytes ≈ ` +
      `${cost.tokens} tokens per request.`,
  );
  if (surface === "tools") {
    console.log("Creel: legacy surface — every skill has its own tool.");
  }
  for (const line of skipped) {
    console.log(`  skipped ${line}`);
  }
  console.log("Reload VS Code (Developer: Reload Window) to pick this up.");
}
