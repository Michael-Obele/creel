#!/usr/bin/env node
/**
 * One command per step, so a release is memory rather than archaeology.
 *
 *   bun run bump     version in every file that carries it, commit + tag
 *   bun run release  the above, then push and create the GitHub release
 *   bun run build    package the .vsix from whatever version package.json says
 *   bun run attach   upload that .vsix onto the GitHub release
 *
 * Or directly: `bun scripts/release.mjs release minor`.
 *
 * The order that matters: release first, build after. The tag is the thing the
 * build is *of*, so the version exists on GitHub before the artifact does, and
 * the manual Marketplace upload carries a version that is already published
 * somewhere else.
 *
 * Flags:
 *   --dry-run     print what would change, touch nothing
 *   --strict      abort if the working tree is dirty (default: warn and carry
 *                 on, staging only the files this script edited)
 *   --root <dir>  run against another checkout; used by the tests
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = "<!-- Describe this release before publishing. -->";

// Every file the bump rewrites. Checked against the working tree *before* any
// edit: staging a file that was already half-edited would carry that unfinished
// work into the release commit, which is the one thing this script must not do.
const BUMP_FILES = [
  "package.json",
  "CHANGELOG.md",
  "README.md",
  "PUBLISHING.md",
  "generate.js",
];

// ---------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = new Set();
const positional = [];

// `--root <dir>` takes a value, and that value is not a positional argument —
// without skipping it, `release --root ./checkout` reads the path as the
// version spec.
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--root") {
    flags.add("--root");
    i++; // consume the value
    continue;
  }
  if (arg.startsWith("--")) {
    flags.add(arg);
    continue;
  }
  positional.push(arg);
}

const command = positional[0] || "help";
const versionSpec = positional[1];
const dryRun = flags.has("--dry-run");
const strict = flags.has("--strict");
const rootArg = argv.find((a) => a.startsWith("--root="));
const rootIdx = argv.indexOf("--root");
const rootDir = rootIdx >= 0 ? argv[rootIdx + 1] : null;
const root =
  rootArg || rootDir
    ? path.resolve((rootArg ? rootArg.slice("--root=".length) : rootDir) || ".")
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Run a command, echoing nothing, failing loudly. */
function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: root, stdio: "pipe", encoding: "utf8", ...opts });
}

function tryRun(cmd) {
  try {
    return { ok: true, out: run(cmd) };
  } catch (error) {
    return {
      ok: false,
      out: String(error.stdout || "") + String(error.stderr || error.message),
    };
  }
}

// ---------------------------------------------------------------------------
// version arithmetic
// ---------------------------------------------------------------------------
function bumpVersion(current, spec = "patch") {
  if (/^\d+\.\d+\.\d+$/.test(spec)) {
    return spec;
  }
  const [major, minor, patch] = current.split(".").map(Number);
  if (spec === "major") return `${major + 1}.0.0`;
  if (spec === "minor") return `${major}.${minor + 1}.0`;
  if (spec !== "patch") {
    throw new Error(
      `unknown version "${spec}" — use patch, minor, major, or x.y.z`,
    );
  }
  // No pre-release or build metadata to carry: Creel versions are plain triples.
  return `${major}.${minor}.${patch + 1}`;
}

// ---------------------------------------------------------------------------
// every place the version is written down
// ---------------------------------------------------------------------------
function replacements(oldVersion, nextVersion) {
  return [
    {
      what: "the version field",
      files: ["package.json"],
      find: `"version": "${oldVersion}"`,
      replace: `"version": "${nextVersion}"`,
    },
    {
      // The installed folder is named after the version, so a stale path here
      // sends the reader to a folder that no longer exists.
      what: "the installed-extension path",
      files: ["generate.js", "README.md"],
      find: `michael-obele.creel-${oldVersion}`,
      replace: `michael-obele.creel-${nextVersion}`,
    },
    {
      what: "the artifact name",
      files: ["PUBLISHING.md", "README.md"],
      find: `creel-${oldVersion}.vsix`,
      replace: `creel-${nextVersion}.vsix`,
    },
    {
      what: "the release commit message",
      files: ["PUBLISHING.md"],
      find: `release: ${oldVersion}`,
      replace: `release: ${nextVersion}`,
    },
    {
      what: "the tag commands",
      files: ["PUBLISHING.md"],
      find: `git tag v${oldVersion}`,
      replace: `git tag v${nextVersion}`,
    },
    {
      what: "the gh release command",
      files: ["PUBLISHING.md"],
      find: `gh release create v${oldVersion}`,
      replace: `gh release create v${nextVersion}`,
    },
    {
      what: "the release title",
      files: ["PUBLISHING.md"],
      find: `--title "v${oldVersion}"`,
      replace: `--title "v${nextVersion}"`,
    },
    {
      what: "the Git tag row",
      files: ["PUBLISHING.md"],
      find: `\`v${oldVersion}\``,
      replace: `\`v${nextVersion}\``,
    },
  ];
}

/**
 * Apply every replacement. Returns the files it touched and any rule that
 * matched nothing — a rule that matches nothing usually means the docs drifted
 * and the next reader would be following a stale command.
 */
function applyBump(oldVersion, nextVersion) {
  const touched = new Map();
  const unmatched = [];

  for (const rule of replacements(oldVersion, nextVersion)) {
    let hits = 0;
    for (const rel of rule.files) {
      const file = path.join(root, rel);
      if (!fs.existsSync(file)) continue;
      const before = fs.readFileSync(file, "utf8");
      if (!before.includes(rule.find)) continue;
      const after = before.split(rule.find).join(rule.replace);
      const count = before.split(rule.find).length - 1;
      hits += count;
      if (!dryRun) fs.writeFileSync(file, after);
      const seen = touched.get(rel) || [];
      seen.push(`${count}× ${rule.what}`);
      touched.set(rel, seen);
    }
    if (hits === 0) unmatched.push(rule.what);
  }

  // A changelog section is added rather than rewritten: the old entries are
  // history, and the new one carries a placeholder comment that renders as
  // nothing if it is never filled in.
  const changelogPath = path.join(root, "CHANGELOG.md");
  if (fs.existsSync(changelogPath)) {
    const text = fs.readFileSync(changelogPath, "utf8");
    if (text.includes(`## ${nextVersion}`)) {
      unmatched.push(`CHANGELOG section for ${nextVersion} (already present)`);
    } else if (text.startsWith("# Changelog")) {
      const stub = `\n## ${nextVersion}\n\n${PLACEHOLDER}\n`;
      if (!dryRun) {
        fs.writeFileSync(
          changelogPath,
          text.replace("# Changelog", `# Changelog\n${stub}`),
        );
      }
      const seen = touched.get("CHANGELOG.md") || [];
      seen.push("new ## section");
      touched.set("CHANGELOG.md", seen);
    } else {
      unmatched.push("CHANGELOG.md (does not start with '# Changelog')");
    }
  }

  return { touched, unmatched };
}

// ---------------------------------------------------------------------------
// release notes come from the changelog, falling back to gh's own summary
// ---------------------------------------------------------------------------
function changelogSection(version) {
  const file = path.join(root, "CHANGELOG.md");
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  const escaped = version.replace(/\./g, "\\.");

  // Split on the heading marker rather than matching a section with a lazy
  // quantifier: `^## X\s*$([\s\S]*?)(?=^## |$)` matches but captures *nothing*,
  // because `$` is satisfied at the end of the heading line itself, so the
  // capture never advances into the content. That bug shipped a GitHub release
  // with generated notes instead of the changelog.
  const parts = text.split(/^## /m);
  for (const part of parts) {
    if (!new RegExp(`^${escaped}(?:\\r?\\n|$)`).test(part)) continue;
    const newline = part.indexOf("\n");
    const body = (newline === -1 ? "" : part.slice(newline + 1)).trim();
    if (!body || body.includes(PLACEHOLDER)) return null;
    return body;
  }
  return null;
}

// ---------------------------------------------------------------------------
// steps
// ---------------------------------------------------------------------------
function currentVersion() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  return pkg.version;
}

function cmdBump(spec) {
  const oldVersion = currentVersion();
  const nextVersion = bumpVersion(oldVersion, spec || "patch");
  if (nextVersion === oldVersion) {
    console.log(`Already at ${oldVersion}.`);
    return nextVersion;
  }

  console.log(
    `${dryRun ? "[dry run] " : ""}Bump ${oldVersion} → ${nextVersion}\n`,
  );
  const { touched, unmatched } = applyBump(oldVersion, nextVersion);

  for (const [file, notes] of touched) {
    console.log(`  ${file}`);
    for (const note of notes) console.log(`      ${note}`);
  }
  if (unmatched.length) {
    console.log("\n  Nothing matched for:");
    for (const what of unmatched) console.log(`      ${what}`);
    console.log("  (usually means the docs drifted — worth an eyeball)");
  }
  console.log("");
  return nextVersion;
}

function cmdBuild() {
  const version = currentVersion();
  const out = `creel-${version}.vsix`;
  if (dryRun) {
    console.log(`[dry run] vsce package --no-dependencies --out ${out}`);
    return;
  }
  console.log(`Packaging creel ${version} …`);
  run(`vsce package --no-dependencies --out ${out}`);
  const stat = fs.statSync(path.join(root, out));
  console.log(`  ${out}  ${(stat.size / 1024).toFixed(1)} KB`);
  console.log(
    `\nNext: bun run attach   (or upload it to the Marketplace by hand)`,
  );
}

function cmdAttach() {
  const version = currentVersion();
  const out = `creel-${version}.vsix`;
  if (!fs.existsSync(path.join(root, out))) {
    throw new Error(`${out} not found — run \`bun run build\` first`);
  }
  if (dryRun) {
    console.log(`[dry run] gh release upload v${version} ${out} --clobber`);
    return;
  }
  run(`gh release upload v${version} ${out} --clobber`);
  console.log(`Attached ${out} to the GitHub release v${version}.`);
}

function cmdRelease(spec) {
  // Read before bumping: applyBump rewrites package.json, so asking for the
  // version afterwards would compare the new number against itself.
  const before = currentVersion();
  // Snapshot the tree before editing anything, so the warning below reports
  // work that was already outstanding — not the files this script just wrote.
  // Porcelain lines are `XY path`, and X is a *space* for an unmodified index.
  // Trimming the output before slicing would drop that leading space and shift
  // the path left — ` M README.md` would slice to `EADME.md` and match nothing.
  const preLines = run("git status --porcelain")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  const prePaths = preLines
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).trim());

  const blocking = BUMP_FILES.filter((file) => prePaths.includes(file));
  const blockers = [];
  if (blocking.length) {
    blockers.push(
      "these files are already modified, and the bump would rewrite them too:\n" +
        blocking.map((file) => `      ${file}`).join("\n") +
        "\n  Staging them would carry that unfinished work into the release commit.\n" +
        "  Commit or stash first, then run this again.",
    );
  }
  if (strict && preLines.length) {
    blockers.push("--strict was given and the tree is dirty. Commit first.");
  }
  if (blockers.length) {
    // A dry run reports the block and keeps going, so the full plan is still
    // visible; a real run stops before touching a single file.
    if (dryRun) {
      console.log(
        "[dry run] release would stop here:\n\n  " +
          blockers.join("\n\n  ") +
          "\n",
      );
    } else {
      throw new Error(blockers.join("\n\n"));
    }
  }

  const nextVersion = cmdBump(spec);
  if (dryRun) {
    console.log("[dry run] skipping commit, tag, push and GitHub release.\n");
    return;
  }
  if (nextVersion === before) {
    throw new Error(`version is already ${before} — nothing to release`);
  }

  // Stage only what this script edited, so any other outstanding work stays
  // out of the release commit.
  if (preLines.length) {
    console.log("\n  Also outstanding, and left alone:");
    for (const line of preLines) console.log(`      ${line}`);
    console.log(
      "  Carrying on — only the files this script edited get committed.\n",
    );
  }

  const files = [
    "package.json",
    "CHANGELOG.md",
    "README.md",
    "PUBLISHING.md",
    "generate.js",
  ].filter((rel) => fs.existsSync(path.join(root, rel)));

  run(`git add ${files.map((f) => `"${f}"`).join(" ")}`);
  run(`git commit -m "release: ${nextVersion}"`);
  run(`git tag v${nextVersion}`);
  console.log(`Committed and tagged v${nextVersion} locally.`);

  // The tag is named rather than left to --follow-tags: that flag is documented
  // as pushing *annotated* tags, and Creel's tags are lightweight.
  const push = tryRun(`git push origin HEAD "v${nextVersion}"`);
  if (!push.ok) {
    console.error(
      "\nPush failed. The commit and tag exist locally — finish with:\n",
    );
    console.error(`    git push origin HEAD "v${nextVersion}"`);
    console.error(
      `    gh release create v${nextVersion} --title "v${nextVersion}" --generate-notes\n`,
    );
    console.error(push.out.trim());
    process.exit(1);
  }
  console.log("Pushed the commit and tag to origin.");

  const notes = changelogSection(nextVersion);
  const create = notes
    ? tryRun(
        `gh release create v${nextVersion} --title "v${nextVersion}" --notes ${JSON.stringify(notes)}`,
      )
    : tryRun(
        `gh release create v${nextVersion} --title "v${nextVersion}" --generate-notes`,
      );
  if (!create.ok) {
    console.error("\nGitHub release failed (the tag is already up):\n");
    console.error(
      `    gh release create v${nextVersion} --title "v${nextVersion}" --generate-notes`,
    );
    console.error(create.out.trim());
    process.exit(1);
  }

  console.log(`\nGitHub release v${nextVersion} created.`);
  if (!notes) {
    console.log(
      "  No changelog section for it yet, so gh generated the notes.",
    );
  }
  console.log(
    "\nNext: bun run build   then bun run attach, or upload by hand.",
  );
}

/**
 * Print the release notes for a version — what `gh release create` will use.
 * Here so the section can be checked (and tested) before anything is public.
 */
function cmdNotes(spec) {
  const version = spec || currentVersion();
  const section = changelogSection(version);
  if (section !== null) {
    console.log(section);
    return;
  }
  const file = path.join(root, "CHANGELOG.md");
  const hasHeading =
    fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(`## ${version}`);
  console.log(
    hasHeading
      ? `(CHANGELOG has ## ${version} but only the placeholder, so gh would generate notes)`
      : `(no ## ${version} section in CHANGELOG.md, so gh would generate notes)`,
  );
}

function cmdHelp() {
  console.log(`
Creel release commands

  bun run bump [patch|minor|major|x.y.z]   version everywhere, commit, tag
  bun run release [patch|minor|major|...]  the above, then push + GitHub release
  bun run build                            package creel-<version>.vsix
  bun run attach                           put that .vsix on the GitHub release

Typical release, in order:

  bun run release        # bumps to 0.2.2, tags v0.2.2, creates the GH release
  bun run build          # creel-0.2.2.vsix
  bun run attach         # attach it to the GH release
  # then upload creel-0.2.2.vsix to the Marketplace by hand

Flags: --dry-run  --strict  --root <dir>
`);
}

// ---------------------------------------------------------------------------
const steps = {
  bump: () => cmdBump(versionSpec),
  release: () => cmdRelease(versionSpec),
  build: () => cmdBuild(),
  attach: () => cmdAttach(),
  notes: () => cmdNotes(versionSpec),
  help: () => cmdHelp(),
};

try {
  (steps[command] || steps.help)();
} catch (error) {
  console.error(`\n${error.message}\n`);
  process.exit(1);
}
