# Publishing Creel

Creel is live on the Marketplace at `michael-obele.creel`, first published 4 October 2026 at version 0.2.0.

**Releases are done by hand, on purpose.** There is no CI workflow and no credential to rotate. A hand upload through the Marketplace website has never needed a token, so it is the one path unaffected by the Personal Access Token retirement on 1 December 2026. For an extension released a few times a year, that beats maintaining a pipeline.

Everything below the checklist is reference.

## One-command release

`scripts/release.mjs` does steps 1–5 and step 9 of the checklist below. It
exists because the version is written down in five places and the git commands
are easy to mistype.

| Command                                        | What it does                                                                                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run release [patch\|minor\|major\|x.y.z]` | Bumps the version everywhere, adds the changelog heading, commits `release: X.Y.Z`, tags `vX.Y.Z`, pushes both, creates the GitHub release. Defaults to `patch`. |
| `bun run build`                                | Runs `vsce package` and writes `creel-<version>.vsix`, reading the version from `package.json` — so it always builds _that_ tag.                                 |
| `bun run attach`                               | Uploads `creel-<version>.vsix` onto the GitHub release.                                                                                                          |
| `bun run bump [spec]`                          | Stops after the file edits and the local commit and tag. Nothing is pushed — for when you want to look first.                                                    |

Every command takes `--dry-run`, which prints what would change and touches
nothing. `--strict` makes `release` abort instead of warning when the tree is
dirty.

A whole release:

```bash
bun run release        # 0.2.1 → 0.2.2, tag v0.2.2, push, GitHub release
# fill in the CHANGELOG.md section it just created
bun run build          # creel-0.2.2.vsix
bun run attach         # put it on the GitHub release
# then upload creel-0.2.2.vsix to the Marketplace by hand — checklist steps 6–8
```

**Fill in the changelog first.** The script inserts `## <version>` carrying an
HTML comment placeholder, which renders as nothing — so an unfilled entry would
ship as a blank section. If the placeholder is still there when `release` runs,
it falls back to `gh --generate-notes` instead of publishing an empty note.

**What it edits, and what it deliberately does not.**

| File                       | Change                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `package.json`             | `"version"`                                                                              |
| `README.md`, `generate.js` | the `~/.vscode/extensions/michael-obele.creel-<version>/` path, which is stale otherwise |
| `PUBLISHING.md`            | the commands and artifact name used as examples                                          |
| `CHANGELOG.md`             | a new `## <version>` heading                                                             |

Historical prose is left alone on purpose. Sentences about what 0.2.0 and 0.2.1
_were_ stay exactly as written, so this file keeps telling the truth about past
releases instead of being rewritten with each one.

**Safety.** Only the files in that table are staged, so unrelated unfinished
work is never swept into a release commit by accident. A rule that matches
nothing is reported at the end — that is the signal the docs have drifted and a
reader would be following a stale command. If `git push` fails, the commit and
the tag still exist locally and the script prints the two commands needed to
finish; nothing is rolled back.

**Order matters: `release` before `build`.** The tag is what the build is _of_,
so the version exists on GitHub before the artifact does, and the manual
Marketplace upload then carries a version that is already published elsewhere.

## Release checklist

Run these in order, from the repository root.

1. **Pick the version.** Patch for docs and fixes, minor for behaviour. Never reuse one; see **Version numbers cannot be reused**.
2. **Bump `package.json`.** Edit `"version"` by hand. Avoid `npm version`, which commits and tags before you have tested the build.
3. **Write the changelog entry.** Newest first in `CHANGELOG.md`, under a `## <version>` heading.
4. **Build it.** `npx --yes @vscode/vsce package`
5. **Commit, tag, push.**

   ```bash
   git add -A
   git commit -m "release: 0.4.0"
   git tag v0.4.0
   git push origin main --tags
   ```

6. **Run the pre-upload checks.** Confirms the tree is clean, the tag on `HEAD` matches the version in `package.json`, and the tool list inside the package is empty.
7. **Upload the `.vsix`** to the Marketplace.
8. **Confirm** the new version is live, then install it from the Marketplace on a different machine.
9. **Cut the GitHub Release** with the `.vsix` attached.

## Version numbers cannot be reused

This is the mistake to avoid, and it has already bitten Creel once. Version 0.2.0 went to the Marketplace carrying the old README. The rewritten README came after, so 0.2.0 could never carry it, and 0.2.1 exists purely to publish a docs change.

The Marketplace freezes a version's content at publish time, README and changelog included.

- A version can be published **once**. Re-uploading it fails with `The extension 'creel' already exists in the Marketplace`.
- You cannot edit the README of a live version. The only fix is a new version.
- You cannot delete the latest version, and a version number you delete can never be reused.

So the version is the one thing that has to be right before you upload. Bump it whenever anything user-visible changes, including docs.

Three places carry the version. Keep them equal:

| Carrier                    | Where                                                             |
| -------------------------- | ----------------------------------------------------------------- |
| `package.json` → `version` | What the Marketplace records, and what names the installed folder |
| Git tag                    | `v0.4.0`                                                          |
| GitHub Release             | Same tag, same `.vsix` asset                                      |

A git tag that disagrees with `package.json` is the error worth guarding against, because it produces a GitHub Release that does not match what the Marketplace actually serves.

## What you need to get

| Thing                     | Where it comes from                                                | Cost          | Needed for   |
| ------------------------- | ------------------------------------------------------------------ | ------------- | ------------ |
| A Microsoft account       | You probably have one. Decide now which account owns the extension | Free          | Everything   |
| Publisher ID              | You invent it on the Marketplace site: `michael-obele`             | Free          | Everything   |
| `creel-0.4.0.vsix`        | `npx --yes @vscode/vsce package`                                   | Free          | Uploading    |
| Azure DevOps organization | https://dev.azure.com, if you have never signed in                 | Free, no card | **Not used** |
| Personal access token     | Azure DevOps → Personal access tokens                              | Free          | **Not used** |

Only the first three are needed, and all three are already done. The last two rows are marked **Not used** because Creel is released by hand, so no Azure DevOps organization and no token exist. Choose the Microsoft account carefully if you ever revisit this, because the publisher ID is permanent.

## One-time setup: the publisher (already done)

Creel went live on 4 October 2026, so the publisher and the listing both exist. This section records what was chosen, kept because a few of these choices are hard to undo. Nothing here is part of a normal release.

### What was entered

Go to [Manage Publishers & Extensions](https://marketplace.visualstudio.com/manage) and sign in with the Microsoft account that should own Creel. That can be personal or work, and it does not need to match your GitHub account.

Select **Create publisher** in the left pane. The form asks for more than you need — this is every field on it:

| Field                                                                                                              | Required | What to enter                                                                                    |
| ------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------ |
| **ID**                                                                                                             | Yes      | `michael-obele` — **must match the `publisher` field in `package.json`, or every publish fails** |
| **Name**                                                                                                           | Yes      | The display name beside your extensions. `Michael Obele` reads better than `michaelobele`        |
| **Verified domain**                                                                                                | No       | **Leave empty.** You cannot qualify yet, and it is not needed to publish — see below             |
| **Description**, **Logo**, **Company website**, **Support**, **LinkedIn**, **Source code repository**, **Twitter** | No       | All optional — paste-ready values in **Filling in About you** below                              |

Then select **Create**. Doing so means you agree to the Visual Studio Marketplace Publisher Agreement.

**Check the ID character by character before you click Create.** The **ID** and the **Name** look almost identical on that form and are easy to swap, and only the **Name** can be changed afterward. The **ID** becomes part of every URL, so `michael-obele.creel` is decided the moment you select Create. A missing hyphen in this field means every publish fails with `vsce cannot find the publisher`, and the fix is to edit `package.json`, `README.md` and your installed folder instead.

Ignore any "personal access token" wording on that page. Creating a publisher in the browser needs only the Microsoft sign-in.

**Filling in About you.** Every field here is optional. This section describes you, the person, not a company. Each link below returned HTTP 200 when checked on 4 October 2026:

| Field                      | Value                                            |
| -------------------------- | ------------------------------------------------ |
| **Description**            | One of the three options below                   |
| **Logo**                   | `icon.png` — 256×256, scales down without a fuss |
| **Company website**        | `https://svelte-apps.me`                         |
| **Support**                | `https://github.com/Michael-Obele/creel/issues`  |
| **Source code repository** | `https://github.com/Michael-Obele/creel`         |
| **LinkedIn**               | `https://www.linkedin.com/in/michael-obele/`     |
| **Twitter**                | `https://x.com/Dev_Obele`                        |

The website field is the easy one to get wrong, because three live sites share a domain:

| URL                      | What it is                                                               | Use it here |
| ------------------------ | ------------------------------------------------------------------------ | ----------- |
| `svelte-apps.me`         | Your own site. Says "one developer, shipping often", "work with Michael" | Yes         |
| `systems.svelte-apps.me` | The SvelteCore Systems Ltd company site                                  | No          |
| `sepia.svelte-apps.me`   | The Sepia product                                                        | No          |

LinkedIn answers `999` to scripted requests. That is its bot block rather than a missing profile, so open it in a browser to satisfy yourself. The form has no Bluesky field, so `https://bsky.app/profile/svelte-apps.me` has nowhere to go.

For **Support**, the issues URL beats an email address: it is public, and the answers help the next person too. The field accepts either.

**Description.** Three options, all first-person and all true. Pick by tone:

| #   | Copy                                                                                                                                                                | Why                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | `Developer tools for AI coding agents. One developer, shipping in the open — Creel for VS Code, and Sepia, a memory server for MCP clients.`                        | Recommended. Says what you do, says who you are, names two products a reader can verify |
| 2   | `Network engineering background, now building developer tools. Creel brings multi-skill # references to GitHub Copilot chat, and Sepia gives MCP clients a memory.` | Leads with the engineer, if you want the credibility first                              |
| 3   | `I'm Michael Obele. I build tools that make AI coding agents more useful — Creel for VS Code, and Sepia, a memory server for MCP clients.`                          | Names you outright, which helps because this text gets quoted away from the page        |

Leave out numbers that will age. Your own site says "526 commits across the last 12 months", which is a fine brag there and a liability in a field you will not revisit.

Two decisions here are hard to undo:

- **The publisher `Name` is what users see**, and changing it later revokes a verified badge. For a personal publisher, `Michael Obele` is the honest form, and plenty of prominent extension publishers are individuals rather than brands. The `ID` stays `michael-obele` regardless, because that is what `package.json` publishes under.
- **The Logo is the publisher's logo, not Creel's.** It sits beside every extension you ever publish, so if you expect more than Creel, a personal mark beats the basket. `icon.png` is fine to start with, and it is a PNG, which is the safe format for a logo upload.

## Build the package

From the repository root, after the version bump is committed:

```bash
npx --yes @vscode/vsce package
```

That writes `creel-0.4.0.vsix`: 9 files, a little under 30 KB. Verified with `vsce` 4.0.0. If you see an `npm does not support Node.js` warning, ignore it; the package still builds.

## Upload the new version

On the [Manage Publishers & Extensions](https://marketplace.visualstudio.com/manage) page, with the `michael-obele` publisher selected:

1. Select the **Creel** extension. On the very first release this was **New extension**, then **Visual Studio Code**; after that it is already in the list.
2. Find the version upload control and drop `creel-<version>.vsix` onto it, or browse for the file.
3. Confirm the upload.

Check the filename against the version `vsce` printed while packaging. The Marketplace takes whichever version is inside the file, and the filename is the only thing telling you which one that is.

## Confirm it went live

The listing appears at:

```
https://marketplace.visualstudio.com/items?itemName=michael-obele.creel
```

Updates usually take a few minutes. Then confirm a real install works, on a machine that is not this one:

```bash
code --install-extension michael-obele.creel
```

## Verified domain: skip it for now

The **Create publisher** form offers to verify a domain, and your publisher's **Details** tab offers it again later. Leave it empty both times. Verification is not required to publish, and the Marketplace will turn you down for the next six months regardless:

> "To become verified, a publisher must have one or more extensions on the VS Marketplace for a minimum of 6 months, and the registration of the domain must also be at least 6 months old."

An eligible domain also has to:

- Let you add a TXT record to its DNS.
- Not be a subdomain, which rules out anything like `michaelobele.github.io`.
- Serve over HTTPS and answer an HTTP 200 to a HEAD request.

When Creel has been on the Marketplace for six months, open your publisher's **Details** tab, type the domain under **Verified domain**, select **Save**, then **Verify**, add the TXT record it shows you, and select **Verify** again. Marketplace staff review it within 5 business days, and the badge then appears next to your publisher name.

One trap worth knowing now: **changing your publisher display name later revokes the badge.** Pick the **Name** you want to keep.

## Pre-upload checks

Run these from the repository root, after the commit and tag in step 5 and before the upload.

```bash
git status --short
```

Expect no output. A modified `package.json` here means one of two things: the version bump is still uncommitted, or you ran `generate.js` inside the repo by mistake. Commit the bump, or clear a stray skill list with `node generate.js --reset`.

```bash
git describe --tags --exact-match 2>/dev/null || echo "no tag on HEAD"
node -p "require('./package.json').version"
```

The two lines above must agree. If they do not, tag the commit you are about to publish, or fix the version, before going any further. This is the check that stops a GitHub Release from disagreeing with what the Marketplace serves.

```bash
node -e "console.log('tools in manifest:', require('./package.json').contributes.languageModelTools.length)"
```

Must print `0`. A packaged Creel ships an empty tool list on purpose: the list is static JSON, so a package cannot know your personal skills in advance, and shipping them would hand your skill list to everyone who installs it. The copy inside the package should be about 1.8 KB, not 99 KB.

```bash
npx --yes @vscode/vsce package
```

Read the file list it prints. It should be exactly nine files, and `icon.png` must be in there.

## Publish the GitHub Release

Step 5 pushes the tag, but a tag is not a Release. Attach the package so a `.vsix` is downloadable without going through the Marketplace:

```bash
gh release create v0.4.0 creel-0.4.0.vsix \
  --repo Michael-Obele/creel \
  --title "v0.4.0" \
  --notes "README rewritten as a landing page. No behaviour change. See CHANGELOG.md."
```

`.gitignore` lists `*.vsix`, so the package is never committed. The Release asset is where it lives.

## Escape hatch: token and CI publishing

Not needed for a manual release. Kept for the day hand-uploading gets tiresome, or you want a pipeline to publish for you. If that day comes, go straight to Entra ID in **Why there is no CI workflow** rather than a token, since a token would only work until 1 December 2026.

The Marketplace runs on Azure DevOps, and a Personal Access Token is the older way to authenticate. Microsoft's own docs say:

> "On December 1, 2026, global Personal Access Tokens (PATs) in Azure DevOps are retired. To keep publishing extensions, use secure automated publishing with Microsoft Entra ID instead of PATs."

That is about eight weeks from today. It does not affect a manual upload, which is why Creel stays manual; it only matters if you automate.

### 1. Create an Azure DevOps organization

Go to https://dev.azure.com and sign in with the **same** Microsoft account that owns the publisher. If Azure DevOps offers to create an organization, accept — it is free and needs no credit card.

This step blocks most first attempts. A personal access token has to live inside an organization, and you cannot make one without first having an organization to put it in.

### 2. Create the token

Open the user settings menu next to your profile picture, then **Personal access tokens**, then **New Token**.

| Setting          | Value                                                                           |
| ---------------- | ------------------------------------------------------------------------------- |
| **Organization** | **All accessible organizations**                                                |
| **Scopes**       | **Custom defined**, then **Show all scopes**, then **Marketplace** → **Manage** |

Both settings matter, and the first is the one people get wrong. A token scoped to a single organization fails later with a 403. Azure shows the token once, so copy it somewhere safe.

### 3. Publish

An environment variable means you never need a separate login step:

```bash
export VSCE_PAT=your-token-here
npx --yes @vscode/vsce publish
```

Or pass it inline for a one-off:

```bash
npx --yes @vscode/vsce publish --pat your-token-here
```

`vsce login michael-obele` also works and remembers the token, but it is an extra step for no benefit.

Because `package.json` already holds the version you want, this does not create a git commit or tag. Only `vsce publish minor` and friends do that, and `--no-git-tag-version` turns it off.

## Reference: what is already in place

| Item                              | State                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Public repo                       | https://github.com/Michael-Obele/creel                                                                    |
| `publisher` field                 | `michael-obele`, already set in `package.json`                                                            |
| Publisher ID free?                | No longer free. `michael-obele` owns the live Creel listing, so treat it as permanent                     |
| Existing extension named `creel`? | Yes. Live at `michael-obele.creel` since 4 October 2026, first version 0.2.0                              |
| Open web                          | Clean. Results for "creel" are dictionary and Wikipedia entries for the word, so page one is winnable     |
| `LICENSE`                         | MIT, present                                                                                              |
| `README.md`                       | Present, and the Marketplace renders it                                                                   |
| `CHANGELOG.md`                    | Present                                                                                                   |
| `icon.png`                        | 256x256, declared as `icon` in `package.json`. Regenerate with `python3 scripts/make-icon.py`             |
| `.vscodeignore`                   | Excludes `.git`, `.fallow`, `install.sh`, `scripts`, `skills.json`, `PUBLISHING.md` and `*.vsix`          |
| Packaging                         | Verified with `vsce` 4.0.0. `npx --yes @vscode/vsce package` produces a 9-file VSIX, a little under 30 KB |
| Release method                    | Manual upload, by choice. No CI workflow and no token; see **Why there is no CI workflow**                |
| Versions published                | `0.2.1`, live since 4 October 2026. Supersedes `0.2.0`, which carried the pre-rewrite README              |
| `@vscode/vsce`                    | Not installed globally. `npx --yes @vscode/vsce` resolves 4.0.0 on its own                                |

## Why there is no CI workflow

Creel is released by hand. Nothing publishes on a tag, and there is no `.github/workflows` directory. That is a decision rather than an oversight:

- A hand upload needs no credential at all, so it is the one path untouched by the 1 December 2026 PAT retirement.
- The documented GitHub Actions recipe publishes with a PAT in a `VSCE_PAT` secret. Building it now would produce a workflow with a working life measured in weeks.
- Entra ID with workload identity federation is the supported replacement, and it is a real afternoon of Azure setup. Worth it for a pipeline that runs daily, not for an extension released a few times a year.

If you ever do want automation, this is what Entra ID takes. Microsoft recommends it over tokens:

1. An Azure DevOps service connection using workload identity federation.
2. A user-assigned managed identity in Azure, with the Reader role.
3. Federated credentials linking Azure DevOps to Azure, with values exchanged in both directions.
4. The managed identity's resource ID, read out with the Azure CLI.
5. That identity added as a Contributor on your publisher.
6. An Azure Pipelines workflow that mints an Entra ID token and runs `vsce publish --azure-credential`.

That is built for a company with an Azure subscription and a pipeline. If you are still maintaining Creel after December 2026, either move publishing into GitHub Actions with a federated identity, or keep uploading the `.vsix` by hand — which keeps working, because it never needed a token in the first place.

## What ends up in the package

`vsce` reads `.vscodeignore`, so the package holds exactly this and nothing else:

```
├─ LICENSE.txt
├─ changelog.md
├─ extension.js
├─ generate.js
├─ icon.png
├─ package.json
└─ readme.md
```

Excluded: `.git`, `.github`, `.vscode`, `.fallow`, `install.sh`, `scripts`, `skills.json`, `PUBLISHING.md` and `*.vsix`. `install.sh` reuses the same file, so a local install and a published package contain the same thing.

## Optional polish before you publish

Three optional `package.json` fields. **All three are already in place**, so
this is reference rather than a step:

```jsonc
"pricing": "Free",                        // adds a "Free" label; the default value is Free anyway
"galleryBanner": { "color": "#22272e" },  // banner behind the listing header
"sponsor": { "url": "https://github.com/sponsors/Michael-Obele" }
```

`galleryBanner` also takes `"theme": "dark"` or `"light"`, which tells the
Marketplace how to contrast the header text; `#22272e` is a dark banner, so add
it if the header text ever looks wrong. All three are read by the Marketplace
gallery, not by VS Code, so `vsce package` accepts them without complaint and
nothing in the extension behaves differently.

## Two things to expect

**The published extension starts with no skills.** The tool list is static JSON in the manifest, so a package cannot know your skills in advance. A fresh install shows the "no skills registered yet" prompt, which offers to run `Creel: Scan skills`. That writes the list and asks for a reload. This is the one rough edge of the design, and it disappears if upstream ever stabilises the `registerToolDefinition` API.

**Do not install the `.vsix` over your local working copy.** Both use the same folder path, so it would replace the working install with an empty tool list. Test a `.vsix` on a different machine, or delete and reinstall from source afterwards.

## If something goes wrong

| Symptom                                      | Cause                                                                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 403 Forbidden or 401 Unauthorized            | The PAT was scoped to one organization instead of **All accessible organizations**, or the scope is not **Marketplace (Manage)** |
| `vsce` cannot find the publisher             | The publisher ID in `package.json` does not match the one you logged in with                                                     |
| The extension installs but `#` shows nothing | Run `Creel: Scan skills`, then reload the window                                                                                 |
| A skill is missing from the `#` list         | Its name collides with a built-in tool, or it duplicates another skill folder. `generate.js` prints what it skipped              |

## Afterwards

- Bump `version` in `package.json` and rename the installed folder to match, since VS Code puts the version in the folder name. Two Creel folders at once register the same tool ids and collide, so delete the old one.
- Add a `CHANGELOG.md` entry for each release.
- Publish to [Open VSX](https://open-vsx.org) too, with `npx ovsx publish`, so VSCodium and other non-Microsoft builds can install Creel. Open VSX needs its own token from https://open-vsx.org/user-settings/tokens, and it has no retirement deadline.
