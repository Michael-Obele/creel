# Publishing Creel

Creel is ready to publish. The fastest route needs no developer token at all: build the package on your machine, then upload the file through the Marketplace website. Set up token publishing only when you want repeat releases or CI.

Checked on 4 October 2026: the Marketplace has **0** extensions named `creel`, and the publisher IDs `michael-obele` and `creel` are both still free.

## What you need to get

| Thing                     | Where it comes from                                                | Cost          | Needed for                |
| ------------------------- | ------------------------------------------------------------------ | ------------- | ------------------------- |
| A Microsoft account       | You probably have one. Decide now which account owns the extension | Free          | Everything                |
| Publisher ID              | You invent it on the Marketplace site: `michael-obele`             | Free          | Everything                |
| `creel-0.2.0.vsix`        | `npx --yes @vscode/vsce package`                                   | Free          | Uploading                 |
| Azure DevOps organization | https://dev.azure.com, if you have never signed in                 | Free, no card | Only for token publishing |
| Personal access token     | Azure DevOps → Personal access tokens                              | Free          | Only for token publishing |

Only the first three are on the fast path. Choose the Microsoft account carefully, because the publisher ID is permanent.

## Fast path: upload the VSIX

Four steps, no tokens, nothing to expire.

### 1. Create the publisher

Go to [Manage Publishers & Extensions](https://marketplace.visualstudio.com/manage) and sign in with the Microsoft account that should own Creel. That can be personal or work, and it does not need to match your GitHub account.

Select **Create publisher** in the left pane, then fill in:

| Field    | What to enter                                                     |
| -------- | ----------------------------------------------------------------- |
| **ID**   | `michael-obele`                                                   |
| **Name** | Your name, or `SvelteCore Systems Ltd` if a company should own it |

The **ID** appears in your extension's URL and **cannot be changed later**. It has to match the `publisher` field in `package.json`, which is already `michael-obele`, so don't improvise.

Ignore any "personal access token" wording on that page. Creating a publisher in the browser needs only the Microsoft sign-in.

### 2. Build the package

From the repository root:

```bash
npx --yes @vscode/vsce package
```

That writes `creel-0.2.0.vsix` — 9 files, about 28 KB. Verified with `vsce` 4.0.0. If you see an `npm does not support Node.js` warning, ignore it; the package still builds.

### 3. Upload it

Back on the [Manage Publishers & Extensions](https://marketplace.visualstudio.com/manage) page, with your publisher selected:

1. Select **New extension**, then **Visual Studio Code**.
2. Drag `creel-0.2.0.vsix` onto the page, or browse for it.
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
| Publisher ID free?                | Yes. `marketplace.visualstudio.com/publishers/michael-obele` returns 404. `creel` is free as a publisher ID too |
| Existing extension named `creel`? | No. The Marketplace returns zero matches                                                                        |
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
