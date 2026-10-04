# Publishing Creel

Creel is live on the Marketplace at `michael-obele.creel`, first published 4 October 2026 at version 0.2.0. The publisher, the listing and the icon are all in place, so a release from here is just: bump, build, upload.

The fastest route needs no developer token at all: build the package on your machine, then upload the file through the Marketplace website. Set up token publishing only when you want repeat releases or CI.

The **Create the publisher** and **Filling in About you** steps below are kept as the record of what was set up. On a normal release, skip straight to **Build the package**.

## What you need to get

| Thing                     | Where it comes from                                                | Cost          | Needed for                |
| ------------------------- | ------------------------------------------------------------------ | ------------- | ------------------------- |
| A Microsoft account       | You probably have one. Decide now which account owns the extension | Free          | Everything                |
| Publisher ID              | You invent it on the Marketplace site: `michael-obele`             | Free          | Everything                |
| `creel-0.2.1.vsix`        | `npx --yes @vscode/vsce package`                                   | Free          | Uploading                 |
| Azure DevOps organization | https://dev.azure.com, if you have never signed in                 | Free, no card | Only for token publishing |
| Personal access token     | Azure DevOps → Personal access tokens                              | Free          | Only for token publishing |

Only the first three are on the fast path. Choose the Microsoft account carefully, because the publisher ID is permanent.

## Fast path: upload the VSIX

Four steps, no tokens, nothing to expire.

### 1. Create the publisher

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

### 2. Build the package

From the repository root:

```bash
npx --yes @vscode/vsce package
```

That writes `creel-0.2.1.vsix` — 9 files, about 28 KB. Verified with `vsce` 4.0.0. If you see an `npm does not support Node.js` warning, ignore it; the package still builds.

### 3. Upload it

Back on the [Manage Publishers & Extensions](https://marketplace.visualstudio.com/manage) page, with your publisher selected:

1. Select **New extension**, then **Visual Studio Code**.
2. Drag `creel-0.2.1.vsix` onto the page, or browse for it.
3. Confirm the upload.

For a later release, the same page takes a new `.vsix` for the extension you already have, so you never repeat the setup above.

### 4. Check it went live

The listing appears at:

```
https://marketplace.visualstudio.com/items?itemName=michael-obele.creel
```

New listings can take a few minutes. Then confirm a real install works, on a machine that is not this one:

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

## Run these checks before you upload

Three commands, from the repository root.

```bash
git status --short
```

Expect no output. If `package.json` shows as modified, you have run `generate.js` inside the repo. Put it back with `node generate.js --reset` before publishing.

```bash
node -e "console.log('tools in manifest:', require('./package.json').contributes.languageModelTools.length)"
```

Must print `0`. A packaged Creel ships an empty tool list on purpose: the list is static JSON, so a package cannot know your personal skills in advance, and shipping them would hand your skill list to everyone who installs it. The copy inside the package should be about 1.8 KB, not 99 KB.

```bash
npx --yes @vscode/vsce package
```

Read the file list it prints. It should be exactly nine files, and `icon.png` must be in there.

## If you use tokens instead: PATs expire on 1 December 2026

The Marketplace runs on Azure DevOps. Today you authenticate with a Personal Access Token. Microsoft's own docs say:

> "On December 1, 2026, global Personal Access Tokens (PATs) in Azure DevOps are retired. To keep publishing extensions, use secure automated publishing with Microsoft Entra ID instead of PATs."

That is about eight weeks from today, which is the main reason the fast path above avoids tokens entirely. Set up a token when uploading by hand gets tiresome, or when you want CI to publish for you.

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

| Item                              | State                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Public repo                       | https://github.com/Michael-Obele/creel                                                                          |
| `publisher` field                 | `michael-obele`, already set in `package.json`                                                                  |
| Publisher ID free?                | No longer free. `michael-obele` owns the live Creel listing, so treat it as permanent                           |
| Existing extension named `creel`? | Yes. Live at `michael-obele.creel` since 4 October 2026, first version 0.2.0                                    |
| Open web                          | Clean. Results for "creel" are dictionary and Wikipedia entries for the word, so page one is winnable           |
| `LICENSE`                         | MIT, present                                                                                                    |
| `README.md`                       | Present, and the Marketplace renders it                                                                         |
| `CHANGELOG.md`                    | Present                                                                                                         |
| `icon.png`                        | 256x256, declared as `icon` in `package.json`. Regenerate with `python3 scripts/make-icon.py`                   |
| `.vscodeignore`                   | Excludes `.git`, `.fallow`, `install.sh`, `scripts`, `skills.json`, `PUBLISHING.md` and `*.vsix`                |
| Packaging                         | Verified with `vsce` 4.0.0. `npx --yes @vscode/vsce package` produces a 9-file, 27.9 KB VSIX                    |
| `@vscode/vsce`                    | Not installed globally. `npx --yes @vscode/vsce` resolves 4.0.0 on its own                                      |

## Skip the Entra ID path

Microsoft recommends Entra ID with workload identity federation instead of tokens, and for a solo extension it is not worth it. What it takes:

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

Three fields worth considering in `package.json`:

```jsonc
"pricing": "Free",                        // adds a "Free" label; the default value is Free anyway
"galleryBanner": { "color": "#22272e" },  // banner behind the listing header
"sponsor": { "url": "https://github.com/sponsors/Michael-Obele" }
```

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

- Bump `version` in `package.json` and rename the installed folder to match, since VS Code puts the version in the folder name.
- Add a `CHANGELOG.md` entry for each release.
- Update the README install section — it currently says "From the Marketplace, once published".
- Publish to [Open VSX](https://open-vsx.org) too, with `npx ovsx publish`, so VSCodium and other non-Microsoft builds can install Creel. Open VSX needs its own token from https://open-vsx.org/user-settings/tokens, and it has no retirement deadline.
