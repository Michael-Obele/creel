#!/usr/bin/env node
"use strict";
// ===========================================================================
// MEASUREMENT SCRIPT — read-only. It sweeps Copilot Chat transcripts, prints
// a markdown report to stdout, and changes nothing on disk. Safe to run any
// time; the only caveat is that the currently-open session's transcript is
// appended to live, so counts drift while a chat is in progress.
//
// What it measures: for every `#skill-*` reference attached in any user
// message across EVERY workspace store, which route delivered the skill body
// (or whether it was never delivered).
//
// ROUTE vs OUTCOME — the distinction this script exists to keep honest:
//   - ROUTE HIT ("hit"/"fallback" below): creel's own tool for that skill ran
//     and returned — tool id `skill_<x>`, legacy `creel_skill_<x>`, or a
//     possible future hyphen form `skill-<x>` (all treated as the same skill).
//     `renderSkill` ran, so the body arrived framed as instructions.
//   - OUTCOME "loaded": the SKILL.md text reached the model by ANY route,
//     including the built-in `skill` tool with `{skill:"<name>"}`, which
//     bypasses the wrapper entirely ("native"). A native SUCCESS is a bypass:
//     loaded, but not a route hit. A native FAILURE followed later by a creel
//     call is a "fallback" — a route hit earned only after the native loader
//     errored (its resolver only knows the first alphabetical slice of the
//     roster, per the 15k `<skills>` budget).
//
// CAVEAT: historical `#` lists may name skills that differed at the time. The
// "known" set is the CURRENT skills.json next to audit.js, so an old reference
// to a renamed/removed skill can read `unresolved` even though it resolved
// when it was sent.
//
// Usage: node scripts/route-matrix.cjs [--since YYYY-MM-DD] [--workspace <hash>]
//   --since YYYY-MM-DD   only transcripts modified on/after that date
//   --workspace <hash>   only one workspaceStorage/<hash>/ store
// Dependency-free: node builtins + audit.js's pure helpers.
// ===========================================================================

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Reused from audit.js (all pure, DOM-free, no vscode): refsIn collects `#`
// tokens, classify sorts creel/editor/other, toolIdFor maps a `#` name to a
// tool id, skillArg reads the built-in skill tool's {skill} argument,
// looksQuoted excludes pasted transcripts, knownRefsFromSkills reads the
// skills.json manifest, percent formats rates.
//
// NOT reused, deliberately reimplemented here:
//   - parseTranscript: it drops assistant.* events, which this script needs
//     for model attribution and for detecting whether the LAST turn of a file
//     is closed (assistant.turn_end). parseEvents below is its superset.
//   - analyze()/verdictFor: verdictFor is not exported, and its semantics
//     predate the split this script measures — it counts ANY native skill call
//     as NATIVE (success or failure indistinguishable), and a creel call
//     with no completion as a HIT. Here a native success is a bypass, a native
//     failure is only a fallback IF creel ran afterwards, and a dangling
//     execution_start is UNKNOWN, not a hit.
const {
  refsIn,
  classify,
  toolIdFor,
  normalizeToolName,
  skillArg,
  looksQuoted,
  knownRefsFromSkills,
  percent,
} = require(path.join(__dirname, "..", "audit.js"));

// One outcome per reference; mutually exclusive so rows can be summed.
const OUTCOMES = [
  "hit", // creel tool ran and returned, no native failure before it
  "fallback", // native skill call FAILED, then the creel tool ran and returned
  "native", // built-in skill tool succeeded; no creel call — bypass
  "failed", // a call happened (either route) and errored; nothing delivered
  "skipped", // closed turn, no call of any kind for this skill
  "unknown", // dangling execution_start with no completion, or an unclosed turn
  "unresolved", // not in the current # list
];

/** Zeroed per-bucket tally. `refs` is the row total the buckets must sum to. */
function blankCounts() {
  const counts = { refs: 0 };
  for (const outcome of OUTCOMES) {
    counts[outcome] = 0;
  }
  return counts;
}

/**
 * Fold any tool-id generation into one comparable form. This is a direct alias
 * for audit.js's `normalizeToolName` — `skill-tdd`, `skill_tdd` and
 * `creel_skill_tdd` all fold to `skill_tdd`, including the legacy `creel_`
 * prefix strip. Deliberately NOT reimplemented here: a local copy that forgot
 * the prefix strip silently turned 15 branded calls into false misses.
 * @param {string} name
 * @returns {string}
 */
const normalizeTool = normalizeToolName;

/**
 * Probe a transcript record for a model name.
 *
 * Verified against real transcripts (copilot 0.63.0, 0.68.0, 0.69.0): NONE of
 * them carry a model field anywhere — `assistant.turn_start.data` is just
 * `{turnId}`, `assistant.message.data` is `{messageId, content, toolRequests,
 * reasoningText?}`, and `session.start.data` has only copilot/vscode versions
 * and a start time. The probes below are defensive for future schema changes;
 * in practice every row lands in "unknown".
 *
 * @param {object} record one parsed .jsonl line
 * @returns {string} model name, or ""
 */
function modelFromRecord(record) {
  const data = record.data || {};
  return (
    data.model ||
    data.modelId ||
    data.modelName ||
    (data.request && data.request.model) ||
    record.model ||
    record.modelId ||
    ""
  );
}

/**
 * Parse one transcript into the events this script needs. Torn lines are
 * skipped: the live session's file is appended to while the assistant works,
 * so a partial final line is normal, not an error.
 *
 * @param {string} name session name (file stem), for display
 * @param {string} text raw .jsonl contents
 * @returns {{session: string, events: Array<object>}}
 */
function parseEvents(name, text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const data = record.data || {};
    const at = record.timestamp || "";
    if (record.type === "user.message") {
      events.push({ kind: "user", at, text: data.content || "" });
    } else if (record.type === "tool.execution_start") {
      // The tool call id is `data.toolCallId` (verified in real files). The
      // record's top-level `id` is the EVENT's own id — never join on it.
      events.push({
        kind: "call",
        at,
        id: data.toolCallId || "",
        tool: data.toolName || "",
        args: data.arguments === undefined ? null : data.arguments,
      });
    } else if (record.type === "tool.execution_complete") {
      events.push({
        kind: "complete",
        at,
        id: data.toolCallId || "",
        success: data.success,
      });
    } else if (record.type === "assistant.turn_end") {
      events.push({ kind: "turnEnd", at });
    } else if (
      record.type === "assistant.message" ||
      record.type === "assistant.turn_start"
    ) {
      const model = modelFromRecord(record);
      if (model) {
        events.push({ kind: "model", at, model });
      }
    }
  }
  return { session: name, events };
}

/**
 * Assemble turns (one user.message to the next) with completion outcomes
 * joined onto each call, plus the two things audit.js's turn shape lacks:
 * a sticky per-turn model name and a `closed` flag (a later user.message in
 * the same file, or an assistant.turn_end). An unclosed last turn may still
 * be live, so "no call" there is unknown, not skipped.
 *
 * @param {{session: string, events: Array<object>}} session
 * @param {Set<string>} known current `#` list, for classify()
 * @returns {Array<object>} turns in chronological order
 */
function turnsFrom(session, known) {
  const turns = [];
  let current = null;
  let lastModel = "";

  const close = () => {
    if (current) {
      turns.push(current);
      current = null;
    }
  };

  for (const event of session.events) {
    if (event.kind === "model") {
      lastModel = event.model;
    } else if (event.kind === "user") {
      if (current) {
        current.closed = true; // a later user.message closes the previous turn
        close();
      }
      // looksQuoted returns the marker that earned the exclusion; only the
      // boolean belongs on the turn.
      current = {
        session: session.session,
        at: event.at,
        text: event.text,
        quoted: looksQuoted(event.text).quoted,
        model: lastModel || "unknown",
        closed: false,
        refs: refsIn(event.text).map((token) => ({
          token,
          kind: classify(token, known),
        })),
        calls: [],
      };
    } else if (event.kind === "complete") {
      if (current) {
        const match = current.calls.find(
          (call) => call.id && call.id === event.id,
        );
        if (match) {
          match.outcome = event.success === false ? "failed" : "ok";
        }
      }
    } else if (event.kind === "turnEnd") {
      if (current) {
        current.closed = true;
      }
    } else if (current && event.kind === "call") {
      current.calls.push({
        id: event.id,
        tool: event.tool,
        args: event.args,
        // pending = the transcript has no completion for it yet: dangling
        // truncation, or a session still being written.
        outcome: "pending",
      });
    }
  }
  close();
  return turns;
}

/**
 * The fate of one creel-kind reference inside one turn. Exactly one of the
 * OUTCOMES is returned, so per-row buckets always sum to the row's ref count.
 *
 * @param {{token: string, kind: string}} ref kind must be "creel"
 * @param {object} turn a turn whose calls carry an outcome
 * @returns {string} one of OUTCOMES
 */
function resolveRef(ref, turn) {
  const id = normalizeTool(toolIdFor(ref.token));
  // The slug the built-in skill tool would be called with: "skill-tdd" -> "tdd".
  const slug = ref.token.slice("skill-".length).toLowerCase();

  const creel = []; // call indexes matching this skill's creel tool id
  const native = []; // call indexes to the generic `skill` tool for this slug
  turn.calls.forEach((call, index) => {
    const norm = normalizeTool(call.tool);
    // Both sides normalised, so current `skill-<x>`, the underscore era
    // `skill_<x>` and the legacy `creel_skill_<x>` all fold together.
    if (norm === id) {
      creel.push(index);
    } else if (call.tool === "skill" && skillArg(call.args) === slug) {
      native.push(index);
    }
  });

  // A successful creel call is a route hit even if the native loader also
  // succeeded later — the wrapper ran, which is the question this column asks.
  const okCreel = creel.find((i) => turn.calls[i].outcome === "ok");
  if (okCreel !== undefined) {
    const nativeFailedFirst = native.some(
      (i) => i < okCreel && turn.calls[i].outcome === "failed",
    );
    return nativeFailedFirst ? "fallback" : "hit";
  }
  if (creel.some((i) => turn.calls[i].outcome === "pending")) {
    return "unknown"; // started, never completed: truncated, not a miss
  }
  if (creel.length) {
    return "failed"; // creel ran and reported an error
  }
  if (native.length) {
    if (native.some((i) => turn.calls[i].outcome === "ok")) {
      return "native"; // bypass: skill loaded, wrapper never ran
    }
    if (native.some((i) => turn.calls[i].outcome === "pending")) {
      return "unknown";
    }
    return "failed"; // native errored and creel was never tried
  }
  // No call at all. Only a closed turn can be judged a skip; the last turn of
  // a live file has not finished, so silence there is unknown.
  return turn.closed ? "skipped" : "unknown";
}

/** Render a counts object as one markdown table row's numeric cells. */
function rowCells(counts) {
  return OUTCOMES.map((outcome) => counts[outcome]).join(" | ");
}

/**
 * Render the full markdown report.
 *
 * @param {object} state aggregation state built in main
 * @returns {string} markdown
 */
function render(state) {
  const { bySkill, byModel, flagged, excluded, meta } = state;
  const lines = [
    "# Creel route matrix",
    "",
    `Read at ${meta.now}.`,
    `Swept \`${meta.root}\`${meta.since ? ` (since ${meta.since})` : ""}` +
      `${meta.workspace ? ` [workspace ${meta.workspace}]` : ""}.`,
    "",
    `Transcripts scanned: **${meta.sessions}**` +
      `${meta.unreadable ? ` (${meta.unreadable} unreadable, skipped)` : ""}` +
      ` — turns: ${meta.turns}. The open session's file is appended to live,`,
    "so counts drift while a chat is in progress.",
    "",
    "Route = did creel's own tool run (`hit`/`fallback`). Outcome = was the",
    "skill loaded at all (`native` bypasses count as loaded, not as route hits).",
    "Historical `#` lists may name skills that differed at the time; `unresolved`",
    "means the name is not in the current skills.json.",
    "",
  ];

  const skills = [...bySkill.entries()].sort(
    (a, b) => b[1].refs - a[1].refs || a[0].localeCompare(b[0]),
  );
  lines.push("## Per skill", "");
  if (!skills.length) {
    lines.push("No `#skill-*` references found in the swept transcripts.", "");
  } else {
    lines.push(
      "| Skill | Refs | Hit | Fallback (native fail → creel) | Native bypass | Failed | Skipped | Unknown | Unresolved |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const [token, counts] of skills) {
      const sum = OUTCOMES.reduce((n, o) => n + counts[o], 0);
      const flag = sum === counts.refs ? "" : ` ⚠️ (row sums to ${sum})`;
      lines.push(
        `| \`${token}\` | ${counts.refs} | ${rowCells(counts)} |${flag}`,
      );
    }
    lines.push(
      "",
      "`hit` + `fallback` are the route rate; add `native` for the load rate.",
      "",
    );
  }

  const models = [...byModel.entries()].sort(
    (a, b) => b[1].refs - a[1].refs || a[0].localeCompare(b[0]),
  );
  lines.push("## Per model", "");
  lines.push(
    "| Model | Refs | Creel hits (hit+fallback) | Native | Skipped | Hit-rate |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const [model, counts] of models) {
    const hits = counts.hit + counts.fallback;
    const rate = counts.refs ? percent(hits / counts.refs) : "—";
    lines.push(
      `| ${model} | ${counts.refs} | ${hits} | ${counts.native} | ${counts.skipped} | ${rate} |`,
    );
  }
  if (!models.length) {
    lines.push("| — | 0 | 0 | 0 | 0 | — |");
  }
  lines.push(
    "",
    "Transcripts carry no model field (verified on copilot 0.63/0.68/0.69), so",
    'every row is expected to read "unknown" until a future schema adds one.',
    "",
  );

  // The invariant, over the whole corpus, in the audit's bucket vocabulary:
  // hits here include fallbacks, misses are skips.
  const total = blankCounts();
  for (const [, counts] of bySkill) {
    total.refs += counts.refs;
    for (const outcome of OUTCOMES) {
      total[outcome] += counts[outcome];
    }
  }
  const hits = total.hit + total.fallback;
  const sum =
    hits +
    total.failed +
    total.native +
    total.skipped +
    total.unresolved +
    total.unknown;
  const ok = sum === total.refs;
  lines.push("## Totals", "");
  lines.push(
    `- refs (${total.refs}) = hits (${hits}) + failed (${total.failed}) + ` +
      `native (${total.native}) + misses/skipped (${total.skipped}) + ` +
      `unresolved (${total.unresolved}) + unknown (${total.unknown}) ` +
      `→ **${ok ? "adds up" : `MISMATCH, Δ = ${total.refs - sum}`}**`,
    `- Loaded by any route (hits + native): ${hits + total.native} of ${total.refs}` +
      ` (${total.refs ? percent((hits + total.native) / total.refs) : "—"})`,
    "",
  );

  if (flagged.length) {
    lines.push(
      `## ⚠️ Turns where the bucket sum ≠ ref count (${flagged.length})`,
      "",
    );
    for (const flag of flagged) {
      lines.push(
        `- \`${flag.session}\` ${flag.at || "(no timestamp)"}: ` +
          `${flag.refs} ref(s), buckets sum to ${flag.sum} — ` +
          `"${flag.text.replace(/\s+/g, " ").trim().slice(0, 120)}"`,
      );
    }
    lines.push("");
  }

  lines.push(
    "## Excluded from every rate",
    "",
    `- Refs inside pasted/quoted output (QUOTED): ${excluded.quoted}`,
    `- VS Code's own \`#file:\`/\`#prompt:\` references (inlined by the editor): ${excluded.editor}`,
    `- Other \`#\` tokens (mostly MCP servers, not skills): ${excluded.other}`,
    "",
  );
  return lines.join("\n");
}

function usage() {
  console.error(
    "usage: node scripts/route-matrix.cjs [--since YYYY-MM-DD] [--workspace <hash>]",
  );
}

function main() {
  let since = null;
  let workspace = null;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--since") {
      const value = args[++i];
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
      if (!match) {
        console.error("--since requires YYYY-MM-DD");
        process.exit(2);
      }
      since = new Date(+match[1], +match[2] - 1, +match[3]);
    } else if (arg === "--workspace") {
      workspace = args[++i];
      if (!workspace) {
        console.error("--workspace requires a workspaceStorage hash");
        process.exit(2);
      }
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      usage();
      process.exit(2);
    }
  }

  // The known `#` list is the current manifest. An empty set is safe:
  // classify() then treats every skill-* token as a creel reference rather
  // than unresolved, which keeps the matrix meaningful even without it.
  const skillsPath = path.join(__dirname, "..", "skills.json");
  let knownList = [];
  if (fs.existsSync(skillsPath)) {
    try {
      knownList = knownRefsFromSkills(
        JSON.parse(fs.readFileSync(skillsPath, "utf8")),
      );
    } catch (err) {
      console.error(
        `skills.json unreadable (${err.message}); treating every skill-* ref as known`,
      );
    }
  }
  const known = new Set(knownList);

  const root = path.join(os.homedir(), ".config/Code/User/workspaceStorage");
  const files = [];
  let stores = [];
  try {
    stores = fs.readdirSync(root);
  } catch (err) {
    console.error(`cannot read ${root}: ${err.message}`);
    process.exit(1);
  }
  for (const store of stores) {
    if (workspace && store !== workspace) {
      continue;
    }
    const dir = path.join(root, store, "GitHub.copilot-chat", "transcripts");
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue; // most stores have no transcripts at all
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) {
        continue;
      }
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        if (since && stat.mtime < since) {
          continue;
        }
        files.push({ full, store, name, mtime: stat.mtime });
      } catch {
        continue;
      }
    }
  }
  files.sort((a, b) => a.mtime - b.mtime);

  const bySkill = new Map();
  const byModel = new Map();
  const flagged = [];
  const excluded = { quoted: 0, editor: 0, other: 0 };
  const meta = {
    now: new Date().toISOString(),
    root,
    since: since ? since.toISOString().slice(0, 10) : null,
    workspace,
    sessions: 0,
    unreadable: 0,
    turns: 0,
  };

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file.full, "utf8");
    } catch {
      // Locked or vanished mid-sweep — skip this file, keep the corpus.
      meta.unreadable++;
      continue;
    }
    meta.sessions++;
    const parsed = parseEvents(file.name.replace(/\.jsonl$/, ""), text);
    for (const turn of turnsFrom(parsed, known)) {
      meta.turns++;
      const attached = turn.refs.filter(
        (ref) => ref.kind === "creel" || ref.kind === "unresolved-creel",
      );
      for (const ref of turn.refs) {
        if (ref.kind === "editor") {
          excluded.editor++;
        } else if (ref.kind === "other") {
          excluded.other++;
        }
      }
      if (turn.quoted) {
        excluded.quoted += attached.length;
        continue;
      }

      // Resolve each ref individually and fold its single outcome into that
      // skill's row and the turn's model row. A turn's aggregate tally is
      // never added to a per-skill row — that would double-count multi-ref
      // turns (each row would receive the whole turn's buckets).
      const local = blankCounts();
      const modelKey = turn.model || "unknown";
      let modelBucket = byModel.get(modelKey);
      if (!modelBucket) {
        modelBucket = blankCounts();
        byModel.set(modelKey, modelBucket);
      }
      modelBucket.refs += attached.length;
      for (const ref of attached) {
        const outcome = resolveRef(ref, turn);
        local[outcome]++;
        let bucket = bySkill.get(ref.token);
        if (!bucket) {
          bucket = blankCounts();
          bySkill.set(ref.token, bucket);
        }
        bucket.refs++;
        bucket[outcome]++;
        modelBucket[outcome]++;
      }
      const localSum = OUTCOMES.reduce((n, o) => n + local[o], 0);
      if (localSum !== attached.length) {
        flagged.push({
          session: turn.session,
          at: turn.at,
          refs: attached.length,
          sum: localSum,
          text: turn.text,
        });
      }
    }
  }

  console.log(render({ bySkill, byModel, flagged, excluded, meta }));
}

main();
