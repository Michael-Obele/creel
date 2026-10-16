"use strict";
/**
 * The audit half.
 *
 * A `#` reference asks the model to call a tool; it does not force the call. The
 * built-in `skill` tool can return the same SKILL.md, and when it does,
 * `renderSkill` never runs — so the body arrives as reading material instead of
 * instructions. That is invisible from inside the extension, but Copilot records
 * every call it makes, in the workspace store next door:
 *
 *   <workspaceStorage>/<id>/GitHub.copilot-chat/transcripts/<session>.jsonl
 *
 * Pure functions over that text: no `vscode`, no disk, no clock. The command
 * layer in extension.js does the I/O.
 *
 * Verdicts: HIT (creel's tool ran and returned) · FAILED (creel's tool ran and
 * reported an error) · NATIVE (the built-in tool read it, so creel's wrapper did
 * not run — the body DID arrive) · NATIVE-FAILED (the built-in tool was tried and
 * errored, so nothing arrived) · NOT-RUN (the model called it and the call never
 * executed) · SKIPPED (nothing called it) · UNRESOLVED (not in the current `#`
 * list) · QUOTED (the token sat inside pasted output, so it was never offered as
 * an attachment and is excluded from the rates) · HANDLED (VS Code inlined it) ·
 * NOT CALLED (another token).
 *
 * Those verdicts are read from two records that must not be confused. An
 * `assistant.message` carries the model's *intent* to call a tool, under the same
 * `toolCallId` the execution will use; `tool.execution_start` carries what
 * actually ran. A call in the first and not the second was decided and never
 * made — a different fact from "nothing called it", and the one this file used to
 * lose. Reading the intent also names every call, which is what makes a failure
 * attributable: `tool.execution_complete` records only `{toolCallId, success}`.
 */

const REF_RE = /#([A-Za-z0-9_][A-Za-z0-9_:.\-]*)/g;

const CREEL_PREFIX = "skill-";

/** VS Code's own skill reader. A call to it is the NATIVE route. */
const NATIVE_TOOL = "skill";

/** Creel's autonomous loader, whose id generate.js owns. */
const LOADER_TOOL = "creel_loadSkill";

/**
 * Every generation of a creel skill tool: `skill-tdd` (current), `skill_tdd`
 * (the underscore era) and `creel_skill_tdd` (the branded era). The loader is
 * `creel_loadSkill`, which this deliberately does NOT match: it is a separate
 * box, checked by name.
 */
const CREEL_TOOL_RE = /^(?:creel_)?skill[-_][a-z0-9]/i;

/**
 * Which route a call took. Two doors are creel's — the per-skill tool and the
 * autonomous loader — and collapsing them is deliberate: the question this
 * answers is "did creel serve it", not "which of creel's tools did".
 * @param {string} tool a tool id, from either an intent or an execution
 * @returns {"creel"|"native"|"other"}
 */
function routeOf(tool) {
  const id = String(tool || "");
  if (id === NATIVE_TOOL) {
    return "native";
  }
  if (id === LOADER_TOOL || CREEL_TOOL_RE.test(id)) {
    return "creel";
  }
  return "other";
}

/**
 * A skill name from a tool argument, folded to the character set a `#` name
 * uses. Tolerates the argument arriving as a string, because a tool shape can
 * change upstream and a throw here would take the whole audit with it.
 * @param {unknown} args
 * @returns {string|null}
 */
function slugOf(args) {
  let value = null;
  if (typeof args === "string") {
    // The two records that describe one call disagree about this field's type:
    // `assistant.message.toolRequests[].arguments` is a JSON *string*, while
    // `tool.execution_start.data.arguments` is already an object. Parse when it
    // parses, because the string form IS a JSON payload; otherwise the caller
    // passed a bare name, which is what the loader receives.
    const text = args.trim();
    if (text.startsWith("{")) {
      try {
        const parsed = JSON.parse(text);
        value = parsed && typeof parsed === "object" ? parsed.skill : null;
      } catch {
        value = null;
      }
    } else {
      value = args;
    }
  } else if (args && typeof args === "object") {
    value = args.skill;
  }
  if (typeof value !== "string") {
    return null;
  }
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || null;
}

/**
 * The `#` reference a call was about, or null when the call was not about a
 * skill.
 *
 * Three shapes carry the name differently, which is the whole reason this is one
 * function. The built-in tool spells it out in its own `skill` argument. So does
 * the loader — but the loader accepts a folder name or a title as readily as a
 * reference, so its result is a best-effort label rather than an exact one. A
 * creel per-skill tool carries the name in the tool id itself, so that one is
 * exact.
 *
 * @param {string} tool
 * @param {unknown} args
 * @returns {string|null} a reference name such as `skill-tdd`, or null
 */
function refOfCall(tool, args) {
  const id = String(tool || "");
  if (id === NATIVE_TOOL || id === LOADER_TOOL) {
    const slug = slugOf(args);
    return slug ? `${CREEL_PREFIX}${slug}` : null;
  }
  if (CREEL_TOOL_RE.test(id)) {
    const normalized = normalizeToolName(id);
    const bare = normalized.startsWith("skill_")
      ? normalized.slice("skill_".length)
      : normalized;
    // Inner separators are folded too, not just the leading one. The underscore
    // era wrote `skill_polya_how_to_solve_it` for what is now
    // `skill-polya-how-to-solve-it`; leaving the inner underscores alone made one
    // skill read as two, and made the older half look unlisted forever.
    return bare ? `${CREEL_PREFIX}${bare.replace(/_/g, "-")}` : null;
  }
  return null;
}

/** Human-readable form of each verdict, for the notification and the report. */
const VERDICT_LABELS = {
  HIT: "called",
  FAILED: "errored",
  NATIVE: "bypassed creel",
  "NATIVE-FAILED": "bypassed, and errored",
  "NOT-RUN": "called but never ran",
  SKIPPED: "never loaded",
  UNRESOLVED: "unresolved",
  QUOTED: "quoted",
  HANDLED: "inlined",
  "NOT CALLED": "not called",
};

/**
 * Signatures of content that was pasted into a message rather than typed as a
 * request: a Copilot transcript, a tool-result payload, an agent-authored
 * prompt. A `#token` inside such a message was never offered to the model as
 * an attachment, so counting it as a miss invents a failure that did not
 * happen. Two or more markers, or any tool-result fence, is a confident call.
 */
const QUOTE_MARKERS = [
  "--- BEGIN TOOL RESULT ---",
  "--- END TOOL RESULT ---",
  "GitHub Copilot:",
  "Completed with input:",
  "Optimized tool selection",
  "Tool execution failed:",
  "You are an assistant mid-conversation",
  "The user has sent you this message:",
  "BEGIN TOOL RESULT",
];

/**
 * @param {string} text a user.message body
 * @returns {{quoted: boolean, marker: string|null}}
 */
function looksQuoted(text) {
  if (!text) {
    return { quoted: false, marker: null };
  }
  let marker = null;
  let hits = 0;
  for (const candidate of QUOTE_MARKERS) {
    if (text.includes(candidate)) {
      hits++;
      marker = marker || candidate;
      if (candidate.includes("TOOL RESULT")) {
        // A fenced tool payload is unambiguous on its own.
        return { quoted: true, marker: candidate };
      }
    }
  }
  return { quoted: hits >= 2, marker };
}

/**
 * Flatten any generation of a creel tool id to one comparable form.
 *
 * Three generations exist in the wild and all three must read as the same
 * skill, or historical transcripts turn into false misses:
 *   `skill-tdd`        current — the tool name is the `#` name
 *   `skill_tdd`        the underscore era (generate.js before 2026-10-12)
 *   `creel_skill_tdd`  the branded era, before the prefix was dropped
 * Everything non-alphanumeric collapses to `_`, and the legacy `creel_`
 * prefix is stripped, so all three normalise to `skill_tdd`.
 *
 * @param {string} name a tool id from a transcript, or a `#` reference name
 * @returns {string}
 */
function normalizeToolName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^creel_/, "");
}

/**
 * Mirrors generate.js: the tool id is the `#` reference name itself, with any
 * legacy `creel_` prefix removed. Kept in step with the generator, or the
 * audit invents misses that are not real.
 * @param {string} referenceName the `#` name, e.g. `skill-copywriting`
 * @returns {string} the tool id, e.g. `skill-copywriting`
 */
function toolIdFor(referenceName) {
  return String(referenceName || "")
    .toLowerCase()
    .replace(/^creel_/, "");
}

/**
 * The `#` names described by a skills.json.
 *
 * Prefers the recorded `reference`, but derives one from the tool id when it is
 * missing: `skill_copywriting` -> `skill-copywriting`. The fallback is the
 * point of this function. skills.json is generated per machine at install time,
 * so an older copy — written before `reference` existed — would otherwise make
 * every genuine reference look unresolved, which is the opposite of useful.
 *
 * The derivation is exact, not a guess. Reference names are built from `[a-z0-9]`
 * with each run of anything else collapsed to a single `-`, and `toolIdFor`
 * collapses those same runs to a single `_`. So a `#` name can never contain an
 * underscore and the round trip loses nothing. Any legacy `creel_` prefix on an
 * older id falls out in the same step.
 *
 * @param {Record<string, {reference?: string}>} skills
 * @returns {string[]}
 */
function knownRefsFromSkills(skills) {
  return Object.entries(skills || {}).map(([id, skill]) => {
    if (skill && typeof skill.reference === "string") {
      return skill.reference;
    }
    return id.replace(/^creel_/, "").replace(/_/g, "-");
  });
}

/**
 * Decide what kind of reference a token is.
 * @param {string} token the text after `#`
 * @param {Set<string>} known the reference names in the current # list
 * @returns {"creel"|"unresolved-creel"|"editor"|"other"}
 */
function classify(token, known) {
  if (known.has(token)) {
    return "creel";
  }
  if (token.startsWith(CREEL_PREFIX)) {
    // Only call it unresolved when we can actually see the # list. With an empty
    // or missing list every name looks unknown, and blaming the list would hide
    // the real and more common cause — the model routing to the built-in skill
    // tool. Treat it as a creel reference and let the verdict come from what ran.
    return known.size === 0 ? "creel" : "unresolved-creel";
  }
  // VS Code's own references all take the `#kind:value` form — `#file:src/x.ts`,
  // `#prompt:review`, `#githubRepo:owner/repo`. It resolves those itself before
  // the model runs, so they are not the model's to call and must not be counted
  // against it. The colon is the tell.
  if (token.includes(":")) {
    return "editor";
  }
  return "other";
}

/**
 * Collect `#` tokens from message text.
 *
 * Guarded against the obvious false positives, because a transcript is full of
 * prose: a `#` glued to a preceding word (`C#`, `docs#build`) is not a
 * reference, and neither is a one- or two-character token.
 *
 * @param {string} text
 * @returns {string[]} distinct tokens, in order of first appearance
 */
function refsIn(text) {
  const found = [];
  const seen = new Set();
  let match;

  REF_RE.lastIndex = 0;
  while ((match = REF_RE.exec(text)) !== null) {
    const before = match.index === 0 ? "" : text[match.index - 1];
    if (/[A-Za-z0-9_]/.test(before)) {
      continue;
    }
    const token = match[1].replace(/[.\-]+$/, "");
    if (token.length < 3 || seen.has(token)) {
      continue;
    }
    seen.add(token);
    found.push(token);
  }
  return found;
}

/**
 * The `skill` tool takes `{ skill: "name" }`. Be tolerant of a bare string so a
 * shape change upstream degrades to "no match" rather than throwing.
 * @param {unknown} args
 * @returns {string|null} lower-cased skill name, or null
 */
function skillArg(args) {
  if (args === null || args === undefined) {
    return null;
  }
  const value = typeof args === "string" ? args : args.skill;
  return typeof value === "string" ? value.toLowerCase() : null;
}

/**
 * Read one transcript into the event kinds the audit cares about: the message
 * that opened a turn, the model's intent to call a tool, each call that actually
 * started, and each call's completion. Every other event type is dropped at the
 * door.
 *
 * The intent is the half that was missing first. `assistant.message.toolRequests`
 * is the model committing to a call, under the `toolCallId` the execution will
 * carry — so a decided-but-never-made call is visible, and the tool's *name* is
 * known even for a call the executor refused.
 *
 * The completion is the half that was missing second. It carries `success`, so a
 * call that started and then errored can be told apart from one that returned.
 * It carries nothing else: no tool name, no error text. The name comes from the
 * matching intent, joined on `toolCallId`.
 *
 * @param {string} name session name, used for display
 * @param {string} text the raw .jsonl contents
 * @returns {{session: string, events: Array<object>}}
 */
function parseTranscript(name, text) {
  const events = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      // A transcript is appended to while the assistant is still working, so a
      // torn final line is normal rather than exceptional. Skip and carry on.
      continue;
    }

    const data = record.data || {};
    if (record.type === "user.message") {
      events.push({
        kind: "user",
        at: record.timestamp || "",
        text: data.content || "",
      });
    } else if (record.type === "assistant.message") {
      // One assistant message can commit to several calls at once, so this
      // fans out rather than pushing a single event.
      const requests = Array.isArray(data.toolRequests) ? data.toolRequests : [];
      for (const request of requests) {
        if (!request || !request.toolCallId) {
          continue;
        }
        events.push({
          kind: "intent",
          at: record.timestamp || "",
          id: request.toolCallId,
          tool: request.name || "",
          // A string here, an object on `tool.execution_start`. Both shapes are
          // tolerated downstream rather than normalised here, so the raw record
          // stays inspectable.
          args: request.arguments === undefined ? null : request.arguments,
        });
      }
    } else if (record.type === "tool.execution_start") {
      events.push({
        kind: "call",
        at: record.timestamp || "",
        id: data.toolCallId || "",
        tool: data.toolName || "",
        args: data.arguments === undefined ? null : data.arguments,
      });
    } else if (record.type === "tool.execution_complete") {
      events.push({
        kind: "complete",
        at: record.timestamp || "",
        id: data.toolCallId || "",
        success: data.success,
      });
    }
  }

  return { session: name, events };
}

/**
 * One record per call, keyed on `toolCallId`, from a session's three sightings
 * of it.
 *
 * Building this in one pass over the whole session — rather than updating a
 * turn's call list as events arrive — is what removes the old lost-completion
 * bug: a completion recorded after the next user message used to find no owner
 * and be dropped, leaving the call `pending` and therefore counted as a hit it
 * never was. Here the outcome is settled before any turn sees the call.
 *
 * @param {{session: string, events: Array<object>}} session
 * @returns {Array<object>} calls, in the order they were first seen
 */
function callsIn(session) {
  const byId = new Map();
  const order = [];

  const open = (event) => {
    let call = byId.get(event.id);
    if (!call) {
      call = {
        id: event.id,
        session: session.session,
        at: event.at || "",
        tool: "",
        args: null,
        // The three sightings, each independently absent in the wild.
        intent: false,
        ran: false,
        success: undefined,
      };
      byId.set(event.id, call);
      order.push(event.id);
    }
    return call;
  };

  for (const event of session.events) {
    if (!event.id) {
      continue;
    }
    if (event.kind === "intent") {
      const call = open(event);
      call.intent = true;
      call.tool = call.tool || event.tool;
      if (call.args === null) {
        call.args = event.args;
      }
    } else if (event.kind === "call") {
      const call = open(event);
      call.ran = true;
      call.startedAt = event.at || "";
      call.tool = event.tool || call.tool;
      // The execution's arguments are an object while the intent's are a JSON
      // string, so prefer the object whenever one is on offer.
      if (event.args && typeof event.args === "object") {
        call.args = event.args;
      } else if (call.args === null) {
        call.args = event.args;
      }
    } else if (event.kind === "complete") {
      open(event).success = event.success;
    }
  }

  return order.map((id) => {
    const call = byId.get(id);
    call.route = routeOf(call.tool);
    call.skill = refOfCall(call.tool, call.args);
    // `ran` and `arrived` are the two questions the old audit could not separate:
    // the model asked, and the tool actually delivered something.
    call.arrived = call.ran && call.success !== false;
    return call;
  });
}

/**
 * The fate of one reference inside one turn.
 *
 * A creel reference counts as a HIT only if its own tool ran and returned.
 * Loading the same skill some other way is deliberately *not* a hit: the skill
 * arrived, but the wrapper that frames it as instructions did not.
 *
 * Four verdicts exist to keep the rates honest, and each one names a fact the
 * old three-way split blurred:
 * - `QUOTED` — the `#token` sat inside pasted output, not a message the user
 *   sent, so it was never offered as an attachment. Shown, then excluded.
 * - `FAILED` — creel's tool ran and reported an error, so nothing was delivered.
 * - `NATIVE-FAILED` — the built-in tool was *tried* and errored. The skill did
 *   not arrive. Counting this as a load was the single biggest inflation in the
 *   published rate.
 * - `NOT-RUN` — the model committed to the call and the call never executed.
 *   That is not the same as no call, and blaming the model for it is wrong.
 *
 * @param {{token: string, kind: string}} ref
 * @param {object} turn a turn whose `calls` are resolved call records
 * @returns {{token: string, kind: string, tool: string|null, verdict: string, detail: string}}
 */
function verdictFor(ref, turn) {
  const out = {
    token: ref.token,
    kind: ref.kind,
    tool: null,
    verdict: "",
    detail: "",
  };

  if (turn.quoted) {
    out.verdict = "QUOTED";
    // Name the marker that triggered it, so a wrong exclusion can be traced to
    // the line that caused it rather than guessed at.
    out.detail =
      "inside pasted or quoted output" +
      (turn.quoteMarker ? ` (saw "${turn.quoteMarker}")` : "") +
      ", not a message sent as a request — excluded from the rates";
    return out;
  }

  if (ref.kind === "creel" || ref.kind === "unresolved-creel") {
    const id = toolIdFor(ref.token);
    out.tool = id;

    // Match on the resolved reference rather than the raw tool name, so all
    // three id generations read as the one skill: `skill-tdd` (current),
    // `skill_tdd` (underscore era) and `creel_skill_tdd` (branded era).
    const mine = (call) => call.skill === ref.token;

    const creel = turn.calls.find(
      (call) => mine(call) && call.route === "creel",
    );
    if (creel) {
      if (!creel.ran) {
        // Decided and never executed. A miss, but a different one: a permission
        // or configuration problem, not model discretion — which is why it is
        // reported apart from SKIPPED instead of inside it.
        out.verdict = "NOT-RUN";
        out.detail =
          `called ${id}, but the call never ran — nothing was executed`;
        return out;
      }
      if (creel.success === false) {
        out.verdict = "FAILED";
        out.detail = `called ${id}, but the tool reported an error — nothing was returned`;
        return out;
      }
      // No completion recorded at all used to mean "still being written". Now
      // that a late completion is joined by id rather than dropped, a missing
      // one is genuinely absent, and saying so beats implying the tool returned.
      out.verdict = "HIT";
      out.detail =
        creel.success === undefined
          ? `called ${id} (no completion recorded yet)`
          : `called ${id}`;
      return out;
    }

    if (ref.kind === "unresolved-creel") {
      out.verdict = "UNRESOLVED";
      out.detail =
        "not in the current # list — the skill was removed or renamed, or the " +
        "list needs rescanning";
      return out;
    }

    const native = turn.calls.find(
      (call) => mine(call) && call.route === "native",
    );
    if (native) {
      if (!native.ran) {
        out.verdict = "NOT-RUN";
        out.detail =
          "called through the built-in skill tool, but the call never ran — " +
          "nothing was executed";
        return out;
      }
      if (native.success === false) {
        // The distinction this report used to lose. The built-in tool was tried,
        // it errored, and the skill therefore never arrived — yet the old
        // verdict said NATIVE and the rate counted it as delivered.
        out.verdict = "NATIVE-FAILED";
        out.detail =
          "the built-in skill tool was tried and errored — the skill did not " +
          "arrive, and creel's wrapper never ran either";
        return out;
      }
      const slug = ref.token.slice(CREEL_PREFIX.length);
      out.verdict = "NATIVE";
      out.detail =
        `not called — ${slug} was read with the built-in skill tool instead; ` +
        "the skill arrived, but creel's wrapper did not run";
      return out;
    }

    out.verdict = "SKIPPED";
    out.detail = "not called — no tool read this skill";
    return out;
  }

  if (ref.kind === "editor") {
    out.verdict = "HANDLED";
    out.detail = "resolved by VS Code before the model runs; no call expected";
    return out;
  }

  // "other" is almost always an MCP server. Those tools are enabled, so they sit
  // in the model's tool list permanently and the `#` is a hint, not a gate —
  // which is exactly the asymmetry that makes creel's own references unreliable.
  const lowered = ref.token.toLowerCase();
  const mcp = turn.callNames.find(
    (name) => name.startsWith("mcp_") && name.toLowerCase().includes(lowered),
  );
  if (mcp) {
    out.tool = mcp;
    out.verdict = "HIT";
    out.detail = `called ${mcp} (already enabled, so the # was only a hint)`;
    return out;
  }

  out.verdict = "NOT CALLED";
  out.detail = "no matching tool ran";
  return out;
}

/** Zeroed counters. Kept in one place so the summary can never go partial. */
function blankTotals() {
  return {
    sessions: 0,
    turns: 0,
    calls: 0,
    turnsWithCreelRefs: 0,
    turnsWithSlash: 0,
    combinedTurns: 0,
    creelRefs: 0,
    creelHits: 0,
    creelFailed: 0,
    creelNative: 0,
    creelNativeFailed: 0,
    creelNotRun: 0,
    creelMisses: 0,
    creelDelivered: 0,
    creelNotDelivered: 0,
    creelLoaded: 0,
    creelLegacyLoaded: 0,
    creelRouteRate: null,
    creelLoadRate: null,
    creelLegacyRate: null,
    unresolved: 0,
    quotedTurns: 0,
    quotedRefs: 0,
    otherRefs: 0,
    otherHits: 0,
    editorRefs: 0,
    turnsWithReferences: 0,
  };
}

/**
 * Correlate references with the calls that followed them.
 *
 * A "turn" runs from one `user.message` to the next, so every tool call is
 * attributed to the message that prompted it. Anything before the first
 * user message is discarded.
 *
 * @param {Array<{session: string, events: Array<object>}>} sessions in chronological order
 * @param {Iterable<string>} knownRefs the reference names in the current # list
 * @returns {{turns: Array<object>, totals: object, calls: Array<object>}}
 */
function analyze(sessions, knownRefs) {
  const known = knownRefs instanceof Set ? knownRefs : new Set(knownRefs || []);
  const turns = [];
  const calls = [];

  for (const session of sessions) {
    const sessionCalls = callsIn(session);
    const byId = new Map(sessionCalls.map((call) => [call.id, call]));
    calls.push(...sessionCalls);

    // Whether the resolved skill is in the `#` list this reader was given. A
    // call outside it is not a miss — it came from another build — but saying
    // which is which stops a stale list from reading as model misbehaviour.
    for (const call of sessionCalls) {
      call.listed = Boolean(call.skill && known.has(call.skill));
    }

    let current = null;
    // Which call ids have already been assigned to a turn. Ownership goes to the
    // FIRST sighting, so a completion that arrives after the next message cannot
    // attach its call to that later turn — and a call first seen before any user
    // message belongs to no turn and is dropped, exactly as before.
    const claimed = new Set();

    const close = () => {
      if (!current) {
        return;
      }
      // Resolve the call records this turn touched. Ownership was settled by the
      // FIRST sighting of each id, so a completion arriving after the next
      // message cannot reassign the call — or strand it as `pending`, which the
      // old reader then counted as a hit.
      current.calls = [...current.callIds]
        .map((id) => byId.get(id))
        .filter(Boolean);
      current.callNames = current.calls.map((call) => call.tool);
      current.refs = current.refs.map((ref) => verdictFor(ref, current));
      current.attached = current.refs.filter(
        (ref) => ref.kind === "creel" || ref.kind === "unresolved-creel",
      );
      current.other = current.refs.filter(
        (ref) => ref.kind === "other" || ref.kind === "editor",
      );
      current.isCombined = current.slash && current.attached.length > 0;
      turns.push(current);
      current = null;
    };

    for (const event of session.events) {
      if (event.kind === "user") {
        close();
        // `looksQuoted` returns a verdict *and* the marker that earned it; only
        // the boolean belongs on the turn, or every message reads as pasted.
        const quote = looksQuoted(event.text);
        current = {
          session: session.session,
          at: event.at,
          text: event.text,
          quoted: quote.quoted,
          quoteMarker: quote.marker,
          slash: /^\s*\//.test(event.text),
          refs: refsIn(event.text).map((token) => ({
            token,
            kind: classify(token, known),
          })),
          callIds: new Set(),
          calls: [],
        };
      } else if (event.id && !claimed.has(event.id)) {
        claimed.add(event.id);
        if (current) {
          current.callIds.add(event.id);
        }
      }
    }

    close();
  }

  const totals = blankTotals();
  totals.sessions = sessions.length;

  for (const turn of turns) {
    totals.turns++;
    totals.calls += turn.calls.length;
    if (turn.slash) {
      totals.turnsWithSlash++;
    }
    if (turn.isCombined) {
      totals.combinedTurns++;
    }
    if (turn.refs.length) {
      totals.turnsWithReferences++;
    }
    if (turn.attached.length) {
      totals.turnsWithCreelRefs++;
    }
    if (turn.quoted) {
      totals.quotedTurns++;
    }

    for (const ref of turn.attached) {
      if (ref.verdict === "QUOTED") {
        totals.quotedRefs++;
        continue;
      }
      totals.creelRefs++;
      if (ref.verdict === "HIT") {
        totals.creelHits++;
      } else if (ref.verdict === "FAILED") {
        totals.creelFailed++;
      } else if (ref.verdict === "NATIVE") {
        totals.creelNative++;
      } else if (ref.verdict === "NATIVE-FAILED") {
        totals.creelNativeFailed++;
      } else if (ref.verdict === "NOT-RUN") {
        totals.creelNotRun++;
      } else if (ref.verdict === "UNRESOLVED") {
        totals.unresolved++;
      } else {
        totals.creelMisses++;
      }
    }

    for (const ref of turn.other) {
      if (ref.verdict === "QUOTED") {
        totals.quotedRefs++;
        continue;
      }
      if (ref.kind === "editor") {
        totals.editorRefs++;
        continue;
      }
      totals.otherRefs++;
      if (ref.verdict === "HIT") {
        totals.otherHits++;
      }
    }
  }

  // Two deliberately separate questions: did the reference drive creel's own
  // tool, and did the skill get read at all. Collapsing them into one "hit rate"
  // is what made the original measurement misleading.
  //
  // `creelDelivered` is the honest numerator: a skill that was attempted and
  // errored did not arrive, so it cannot count. `creelLegacyLoaded` is what this
  // report published before 2026-10-16, when a failed built-in attempt was
  // credited as a load; it is kept so older baselines stay readable rather than
  // being silently restated, and it is reported beneath the corrected figure.
  totals.creelDelivered = totals.creelHits + totals.creelNative;
  totals.creelNotDelivered =
    totals.creelFailed + totals.creelNativeFailed + totals.creelNotRun;
  totals.creelLoaded = totals.creelDelivered;
  totals.creelRouteRate = totals.creelRefs
    ? totals.creelHits / totals.creelRefs
    : null;
  totals.creelLoadRate = totals.creelRefs
    ? totals.creelDelivered / totals.creelRefs
    : null;
  totals.creelLegacyLoaded = totals.creelDelivered + totals.creelNativeFailed;
  totals.creelLegacyRate = totals.creelRefs
    ? totals.creelLegacyLoaded / totals.creelRefs
    : null;

  return { turns, totals, calls };
}

/**
 * The most recent message that attached at least one skill with `#`.
 * Returns null when there is nothing to check.
 * @param {{turns: Array<object>}} report
 * @returns {object|null}
 */
function latestTurn(report) {
  for (let i = report.turns.length - 1; i >= 0; i--) {
    const attached = report.turns[i].attached;
    // A turn whose only references were pasted is not something the user sent,
    // so "check my last message" must not answer about it.
    if (attached.some((ref) => ref.verdict !== "QUOTED")) {
      return report.turns[i];
    }
  }
  return null;
}

/**
 * Attribute each injection record to the message that caused it.
 *
 * This is the join the audit was missing. The transcript knows which route a
 * skill took; `injections.jsonl` knows which wrapper shape it arrived in; until
 * now nothing put the two together, so "did `must-keep` actually get followed?"
 * had no answer.
 *
 * A turn runs from its own `at` to the next turn in the same session, matching
 * how `analyze` builds them. A row that falls outside every window is reported
 * rather than dropped — it usually means the injection happened in another
 * window while this one's transcript was being read, and silently losing it
 * would understate the call count.
 *
 * A record with no matching reference in its turn is `AUTONOMOUS`: creel
 * rendered a payload the user never attached with `#`, which is to say the
 * model fetched the skill itself. That is a success, not a miss, so it never
 * lands in the miss counters.
 *
 * Pure: no clock, no disk, no `vscode`.
 *
 * @param {{turns: Array<object>}|null} report from `analyze`
 * @param {Array<{at: string, tool: string, reference: string, variant: string, chars: number}>} [injections]
 * @returns {{joined: Array<object>, unjoined: Array<object>, byVariant: Record<string, object>}}
 */
function joinInjections(report, injections) {
  const turns = (report && report.turns) || [];

  // Index turns into half-open windows [start, end), scoped per session so a
  // second workspace's history cannot absorb this one's records.
  const windows = [];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (!turn.at) {
      continue;
    }
    let end = null;
    for (let j = i + 1; j < turns.length; j++) {
      if (turns[j].session === turn.session) {
        end = turns[j].at;
        break;
      }
    }
    windows.push({ turn, start: turn.at, end });
  }

  const joined = [];
  const unjoined = [];

  for (const record of injections || []) {
    if (!record || typeof record.at !== "string") {
      unjoined.push(record);
      continue;
    }
    const window = windows.find(
      (candidate) =>
        record.at >= candidate.start &&
        (candidate.end === null || record.at < candidate.end),
    );
    if (!window) {
      unjoined.push(record);
      continue;
    }
    const ref = window.turn.refs.find((r) => r.token === record.reference);
    joined.push({
      ...record,
      session: window.turn.session,
      verdict: ref ? ref.verdict : "AUTONOMOUS",
      detail: ref ? ref.detail : "loaded without a # reference in this message",
      route: ref ? "forced" : "autonomous",
    });
  }

  const byVariant = {};
  for (const row of joined) {
    const key = row.variant || "baseline";
    const bucket =
      byVariant[key] ||
      (byVariant[key] = {
        calls: 0,
        chars: 0,
        forced: 0,
        autonomous: 0,
        verdicts: {},
      });
    bucket.calls++;
    bucket.chars += row.chars || 0;
    bucket[row.route]++;
    bucket.verdicts[row.verdict] = (bucket.verdicts[row.verdict] || 0) + 1;
  }

  return { joined, unjoined, byVariant };
}

/**
 * The telemetry report, as markdown, for an untitled editor.
 * Pure — the clock and the skill list arrive in `meta` rather than being read
 * here, which is what keeps this file runnable as `node audit.js`.
 *
 * @param {{joined: Array<object>, unjoined: Array<object>, byVariant: Record<string, object>}} joined
 *   the result of `joinInjections`
 * @param {{now: string, source?: string, blocked?: string[]}} meta
 * @returns {string}
 */
function telemetryMarkdown(joined, meta) {
  const byVariant = (joined && joined.byVariant) || {};
  const rows = (joined && joined.joined) || [];
  const strays = (joined && joined.unjoined) || [];

  const lines = [
    "# Creel telemetry",
    "",
    `Read at ${meta.now}.`,
    meta.source ? `Source: \`${meta.source}\`` : "",
    "",
    "Each row is one tool call creel actually rendered. `Forced` came from a `#`",
    "reference in the user's message; `Autonomous` is the model deciding on its own",
    "that a skill applied. A variant that never appears below has never shipped a",
    "payload, which is the point of running this.",
    "",
    "## By wrapper variant",
    "",
    "| Variant | Calls | Forced | Autonomous | Mean chars | Verdicts |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  const variants = Object.keys(byVariant).sort();
  if (!variants.length) {
    lines.push("| — | 0 | 0 | 0 | — | — |");
  }
  for (const key of variants) {
    const bucket = byVariant[key];
    const mean = bucket.calls ? Math.round(bucket.chars / bucket.calls) : 0;
    const verdicts = Object.entries(bucket.verdicts || {})
      .map(([name, count]) => `${name} ${count}`)
      .join(", ");
    lines.push(
      `| \`${key}\` | ${bucket.calls} | ${bucket.forced} | ${bucket.autonomous} | ${mean} | ${verdicts} |`,
    );
  }

  lines.push("", "## Largest payloads", "");
  const largest = [...rows]
    .sort((a, b) => (b.chars || 0) - (a.chars || 0))
    .slice(0, 5);
  if (largest.length) {
    lines.push(
      "| Chars | Skill | Variant | Route |",
      "| --- | --- | --- | --- |",
    );
    for (const row of largest) {
      lines.push(
        `| ${row.chars} | \`${row.reference || row.tool}\` | ${row.variant} | ${row.route} |`,
      );
    }
  } else {
    lines.push("No injections recorded.");
  }

  if (strays.length) {
    lines.push(
      "",
      `## Unjoined (${strays.length})`,
      "",
      "Injections with no matching message in this workspace — usually recorded in",
      "another window, or before this transcript started. Counted nowhere above, so",
      "the rates are not inflated by them.",
      "",
    );
  }

  lines.push("## Skills the built-in loader refuses", "");
  const blocked = (meta.blocked || [])
    .slice()
    .sort((a, b) => a.localeCompare(b));
  lines.push(
    blocked.length
      ? `${blocked.length} skill(s) carry \`disable-model-invocation: true\`, so VS Code's own loader answers "Skill not found". \`creel_loadSkill\` and \`#\` both still work:\n\n` +
          blocked.map((name) => `- \`${name}\``).join("\n")
      : "None — every scanned skill is loadable by the built-in loader.",
    "",
  );

  return lines.join("\n");
}

/** Percentages read badly as `0.5`; the notification and report both want `50%`. */
function percent(rate) {
  return rate === null || rate === undefined
    ? "—"
    : `${Math.round(rate * 100)}%`;
}

/**
 * Every call that was about a skill, counted by skill — whether or not a `#`
 * reference caused it.
 *
 * This is the view the ref-keyed audit could not provide. A reference-keyed
 * report can only ever answer "was the thing I typed honoured"; ask it about a
 * skill the model loaded on its own and there is nothing to read. Counting calls
 * answers the question people actually ask.
 *
 * Deliberately carries no message text and no reasoning text: skill names and
 * counts only. That is what makes it safe to run across every workspace on the
 * machine, which is the only way the numbers get big enough to mean anything.
 *
 * @param {Array<object>} calls from `analyze`
 * @returns {{calls: number, required: number, arrived: number, failed: number,
 *   neverRan: number, creel: number, native: number, unlabelled: number,
 *   unlisted: number, bySkill: Record<string, object>}}
 */
function callTotals(calls) {
  const summary = {
    calls: 0,
    required: 0,
    arrived: 0,
    failed: 0,
    neverRan: 0,
    creel: 0,
    native: 0,
    unlabelled: 0,
    unlisted: 0,
    bySkill: {},
  };

  for (const call of calls || []) {
    if (!call) {
      continue;
    }
    // Only calls that were about a skill: anything on a skill route, whether or
    // not the name could be recovered. Every other tool on the machine is not
    // this view's business, and counting them would drown the signal.
    if (call.route === "other" && !call.skill) {
      continue;
    }
    summary.calls++;
    if (call.route === "creel") {
      summary.creel++;
    } else if (call.route === "native") {
      summary.native++;
    }
    if (call.intent) {
      summary.required++;
    }
    if (!call.ran) {
      summary.neverRan++;
    } else if (call.success === false) {
      summary.failed++;
    } else if (call.arrived) {
      summary.arrived++;
    }
    if (!call.skill) {
      summary.unlabelled++;
      continue;
    }
    if (call.listed === false) {
      summary.unlisted++;
    }
    const bucket =
      summary.bySkill[call.skill] ||
      (summary.bySkill[call.skill] = {
        calls: 0,
        arrived: 0,
        failed: 0,
        neverRan: 0,
        routes: {},
      });
    bucket.calls++;
    bucket.routes[call.route] = (bucket.routes[call.route] || 0) + 1;
    if (!call.ran) {
      bucket.neverRan++;
    } else if (call.success === false) {
      bucket.failed++;
    } else if (call.arrived) {
      bucket.arrived++;
    }
  }

  return summary;
}

/** How many rows the per-skill table prints before it says what it left out. */
const MAX_CALL_ROWS = 40;

/**
 * The call-keyed view, as markdown. Counts only — see `callTotals`.
 * @param {object} summary the result of `callTotals`
 * @returns {string}
 */
function callsMarkdown(summary) {
  const lines = [
    "## Every skill run",
    "",
    "Every call that was about a skill, whether or not a `#` reference caused it, so",
    "an autonomous load appears here too. Counts only: no message text, no reasoning",
    "text, nothing quoted from a prompt.",
    "",
    `- Calls about a skill: **${summary.calls}**`,
    `- Through creel: **${summary.creel}** · through the built-in skill tool: **${summary.native}**`,
    `- Arrived: **${summary.arrived}** · errored: **${summary.failed}** · called but never ran: **${summary.neverRan}**`,
    summary.unlabelled
      ? `- No skill name in the call, so not attributed: **${summary.unlabelled}**`
      : undefined,
    summary.unlisted
      ? `- Named a skill outside the current \`#\` list, so from another build: **${summary.unlisted}**`
      : undefined,
    "",
  ];

  const skills = Object.entries(summary.bySkill || {});
  if (!skills.length) {
    lines.push("No call in these transcripts was about a skill.", "");
    return lines.filter((line) => line !== undefined).join("\n");
  }

  skills.sort((a, b) => b[1].calls - a[1].calls || a[0].localeCompare(b[0]));
  lines.push(
    "| Skill | Calls | Creel | Built-in | Arrived | Errored | Never ran |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const [skill, bucket] of skills.slice(0, MAX_CALL_ROWS)) {
    lines.push(
      `| \`${skill}\` | ${bucket.calls} | ${bucket.routes.creel || 0} | ` +
        `${bucket.routes.native || 0} | ${bucket.arrived} | ${bucket.failed} | ${bucket.neverRan} |`,
    );
  }
  if (skills.length > MAX_CALL_ROWS) {
    lines.push(
      "",
      `Showing the ${MAX_CALL_ROWS} most-called of ${skills.length} skills.`,
    );
  }
  lines.push("");
  return lines.filter((line) => line !== undefined).join("\n");
}

/**
 * The full report, as markdown, for opening in an untitled editor.
 *
 * @param {object} report from `analyze`
 * @param {{source?: string, now: string}} meta `now` is passed in rather than
 *   read here, so this function stays free of the clock like everything else.
 * @returns {string}
 */
function toMarkdown(report, meta) {
  const t = report.totals;
  const lines = [
    "# Creel skill audit",
    "",
    `Read at ${meta.now}.`,
    meta.source ? `Source: \`${meta.source}\`` : "",
    "",
    "A `#` reference asks the model to call a tool; it does not force it, and it does not",
    "paste the file. This report shows which attached skills were actually loaded, and by",
    "which route.",
    "",
    "## Summary",
    "",
    `- Messages read: **${t.turns}** across ${t.sessions} transcript(s)`,
    t.quotedTurns
      ? `- Of those, **${t.quotedTurns}** look like pasted or quoted output and are ` +
        `excluded from every rate below (${t.quotedRefs} reference(s))`
      : undefined,
    `- Skill references attached with \`#\`: **${t.creelRefs}**`,
    `- Called the creel tool: **${t.creelHits}** (${percent(t.creelRouteRate)})`,
    t.creelFailed
      ? `- Called the creel tool, but it reported an error: **${t.creelFailed}**`
      : undefined,
    `- Read by the built-in skill tool instead: **${t.creelNative}**`,
    t.creelNativeFailed
      ? `- The built-in skill tool was tried and **errored**, so nothing arrived: ` +
        `**${t.creelNativeFailed}**`
      : undefined,
    t.creelNotRun
      ? `- Called, but the call **never ran**: **${t.creelNotRun}**`
      : undefined,
    `- Never read at all: **${t.creelMisses}**`,
    `- Skill arrived by any route: **${t.creelDelivered}** of ${t.creelRefs} (${percent(t.creelLoadRate)})`,
    t.creelLegacyLoaded !== t.creelDelivered
      ? `- *The same figure as this report printed before 2026-10-16: ` +
        `**${t.creelLegacyLoaded}** of ${t.creelRefs} (${percent(t.creelLegacyRate)}). ` +
        `It counted a built-in attempt that errored as a load, so it read high.*`
      : undefined,
    `- Other \`#\` tokens, mostly MCP servers: **${t.otherHits}/${t.otherRefs}** called`,
    `- VS Code's own references (\`#file:\`, \`#prompt:\`), inlined by VS Code: **${t.editorRefs}**`,
    `- Messages using a slash skill: **${t.turnsWithSlash}**`,
    `- Messages using a slash skill *and* a \`#\` reference: **${t.combinedTurns}**`,
    "",
  ];

  const withRefs = report.turns.filter((turn) => turn.refs.length);
  const callSection = callsMarkdown(callTotals(report.calls));
  if (!withRefs.length) {
    lines.push(
      "No message in these transcripts attached anything with `#`.",
      "",
      callSection,
    );
    return lines.filter((line) => line !== undefined).join("\n");
  }

  // The report opens in an editor, so an unbounded table is unusable: a long
  // history can run to hundreds of kilobytes. Keep the most recent slice and say
  // what was left out rather than silently truncating.
  const MAX_ROWS = 30;
  const shown = withRefs.slice(-MAX_ROWS);
  const omitted = withRefs.length - shown.length;

  // The call-keyed view goes first: "was skill X called" is the question people
  // arrive with, and it is answerable for skills that no reference ever named.
  lines.push(callSection, "## Messages that attached something", "");
  if (omitted) {
    lines.push(
      `Showing the most recent ${MAX_ROWS} of ${withRefs.length}.`,
      "",
    );
  }
  lines.push("| When | Message | Attached | Outcome |");
  lines.push("| --- | --- | --- | --- |");

  for (const turn of shown) {
    const when = turn.at ? turn.at.replace("T", " ").replace("Z", "") : "—";
    const message = turn.text.replace(/\s+/g, " ").trim().slice(0, 120);
    const attached = turn.refs.map((ref) => `\`#${ref.token}\``).join(" ");
    const outcome = turn.refs
      .map(
        (ref) =>
          `${VERDICT_LABELS[ref.verdict] || ref.verdict}${
            ref.kind === "creel" || ref.kind === "unresolved-creel"
              ? ""
              : " (not a skill)"
          }`,
      )
      .join(" · ");
    lines.push(`| ${when} | ${message} | ${attached} | ${outcome} |`);
  }

  lines.push("", "## Detail", "");
  for (const turn of shown) {
    lines.push(
      `**${turn.at || "—"}** — ${turn.text.replace(/\s+/g, " ").trim().slice(0, 200)}`,
      "",
    );
    for (const ref of turn.refs) {
      lines.push(`- \`#${ref.token}\` — ${ref.verdict}: ${ref.detail}`);
    }
    lines.push("");
  }

  return lines.filter((line) => line !== undefined).join("\n");
}

module.exports = {
  VERDICT_LABELS,
  NATIVE_TOOL,
  LOADER_TOOL,
  toolIdFor,
  normalizeToolName,
  routeOf,
  refOfCall,
  slugOf,
  knownRefsFromSkills,
  classify,
  refsIn,
  skillArg,
  looksQuoted,
  parseTranscript,
  callsIn,
  analyze,
  latestTurn,
  joinInjections,
  telemetryMarkdown,
  callTotals,
  callsMarkdown,
  percent,
  toMarkdown,
};

// `node audit.js [transcripts-dir]` — check the analysis without VS Code.
if (require.main === module) {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");

  const dir =
    process.argv[2] ||
    path.join(
      os.homedir(),
      ".config/Code/User/workspaceStorage/36b062da158936884bd0911815c45643/GitHub.copilot-chat/transcripts",
    );

  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => {
      const full = path.join(dir, name);
      return { full, name, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => a.mtime - b.mtime);

  const sessions = files.map((file) =>
    parseTranscript(
      file.name.replace(/\.jsonl$/, ""),
      fs.readFileSync(file.full, "utf8"),
    ),
  );

  // The repo ships no skills.json on purpose. An empty list is safe: classify()
  // then treats every `skill-*` token as a creel reference, not as unresolved.
  const skillsPath = path.join(__dirname, "skills.json");
  const known = fs.existsSync(skillsPath)
    ? knownRefsFromSkills(JSON.parse(fs.readFileSync(skillsPath, "utf8")))
    : [];

  const report = analyze(sessions, known);
  const turn = latestTurn(report);
  console.log(JSON.stringify(report.totals, null, 2));
  console.log(
    turn
      ? `\nLast message with a reference:\n  ${turn.text.slice(0, 120)}\n` +
          turn.attached
            .map((ref) => `  #${ref.token} -> ${ref.verdict} (${ref.detail})`)
            .join("\n")
      : "\nNo message attached a skill with #.",
  );
}
