#!/usr/bin/env node
/**
 * Why did that skill call fail? — triage a failed skill load in any workspace.
 *
 *   node scripts/why-failed.cjs                 # every failure, all workspaces
 *   node scripts/why-failed.cjs svelte          # transcripts whose text matches
 *   node scripts/why-failed.cjs --ws 1834197a   # one workspace hash
 *   node scripts/why-failed.cjs --since 2026-10-20
 *
 * A transcript records no error text and no model name — only the shape of the
 * call. The shape is still enough to tell these apart, because each cause leaves
 * a different set of records:
 *
 *   NATIVE-NOT-FOUND  built-in `skill` ran and returned success:false.
 *                     The name sits past the 15k `<skills>` roster cut, which
 *                     makes it advertised-but-unresolvable.
 *   NATIVE-WRONG-NAME built-in `skill` called with a creel tool id
 *                     (`creel_skill_x`) instead of a skill name.
 *   CREEL-THREW       a `skill-x` / `skill_x` tool started and reported
 *                     success:false — creel's own handler failed.
 *   CREEL-REFUSED     a `skill-x` tool has a completion with success:false and
 *                     NO execution_start: the client would not run the call
 *                     (tool absent from that request, e.g. over the 128-tool
 *                     ceiling, or deferred).
 *   CREEL-DROPPED     requested, no start, no completion: the session ended
 *                     mid-turn, so the outcome is unknown, not a failure.
 */
const fs = require("node:fs");
const path = require("node:path");

const STORE = path.join(
  process.env.HOME || process.env.USERPROFILE,
  process.env.CODE_USER_DIR || ".config/Code/User",
  "workspaceStorage",
);

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const wsFilter = flag("--ws");
const since = flag("--since");
const needles = argv.filter((a, i) => !a.startsWith("--") && i !== argv.indexOf("--ws") + 1 && i !== argv.indexOf("--since") + 1);

function workspacePath(hash) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(STORE, hash, "workspace.json"), "utf8"));
    return decodeURIComponent(j.folder || j.workspace || "(empty)").replace(/^file:\/\//, "");
  } catch {
    return "(no workspace.json)";
  }
}

const isCreelTool = (name) => /^(creel_)?skill[-_]/.test(name || "");
const looksLikeToolId = (arg) => /^(creel_)?skill[-_]/.test(arg || "");

function classify(req, start, done) {
  const native = req.name === "skill";
  if (native) {
    if (done && done.ok !== false) return null;
    if (!done) return "NATIVE-DROPPED";
    return looksLikeToolId(req.skill) ? "NATIVE-WRONG-NAME" : "NATIVE-NOT-FOUND";
  }
  if (isCreelTool(req.name)) {
    if (!done && !start) return "CREEL-DROPPED";
    if (done && done.ok === false) return start ? "CREEL-THREW" : "CREEL-REFUSED";
    return null;
  }
  if (done && done.ok === false) return "OTHER-TOOL-FAILED";
  return null;
}

const rows = [];
for (const hash of fs.readdirSync(STORE)) {
  if (wsFilter && !hash.startsWith(wsFilter)) continue;
  if (!fs.statSync(path.join(STORE, hash)).isDirectory()) continue;
  const dir = path.join(STORE, hash, "GitHub.copilot-chat", "transcripts");
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    if (needles.length && !needles.every((n) => raw.toLowerCase().includes(n.toLowerCase()))) continue;
    const starts = new Map();
    const completes = new Map();
    const reqs = [];
    let turn = null;
    for (const line of raw.split("\n")) {
      if (!line) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      const d = e.data || {};
      if (e.type === "user.message") turn = { ts: e.timestamp, text: String(d.content || "") };
      if (e.type === "assistant.message" && Array.isArray(d.toolRequests))
        for (const r of d.toolRequests)
          if (/skill/i.test(r.name || ""))
            reqs.push({
              ts: e.timestamp,
              turn,
              name: r.name,
              id: r.id || r.toolCallId,
              skill: (() => {
                try {
                  return JSON.parse(r.arguments || "{}").skill || "";
                } catch {
                  return "";
                }
              })(),
            });
      if (e.type === "tool.execution_start") starts.set(d.toolCallId, { ts: e.timestamp, name: d.toolName });
      if (e.type === "tool.execution_complete") completes.set(d.toolCallId, { ts: e.timestamp, ok: d.success });
    }
    for (const r of reqs) {
      const shape = classify(r, starts.get(r.id), completes.get(r.id));
      if (!shape) continue;
      const at = (starts.get(r.id) || {}).ts || (completes.get(r.id) || {}).ts || r.ts;
      if (since && at < since) continue;
      rows.push({
        shape,
        when: new Date(at).toISOString(),
        hash: hash.slice(0, 8),
        ws: workspacePath(hash),
        label: r.name + (r.skill ? `(${r.skill})` : ""),
        text: (r.turn && r.turn.text ? r.turn.text : "").replace(/\s+/g, " ").slice(0, 64),
      });
    }
  }
}

rows.sort((a, b) => (a.when < b.when ? 1 : -1));
for (const r of rows)
  console.log(`${r.when.slice(0, 16)}  ${r.shape.padEnd(16)} ${r.label.padEnd(34)} ${r.ws}  ::  ${r.text}`);

const byShape = {};
for (const r of rows) byShape[r.shape] = (byShape[r.shape] || 0) + 1;
console.log(`\n${rows.length} failed skill call(s)`, byShape);
console.log("No error text exists in a transcript — reproduce in that window for the message itself.");
