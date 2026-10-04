# Publishing Nkana

Everything needed to put Nkana on the Visual Studio Marketplace, checked on 4 October 2026.

## Read this first: PATs expire on 1 December 2026

The Marketplace runs on Azure DevOps. Today you authenticate with a Personal Access Token. Microsoft's own docs say:

> "On December 1, 2026, global Personal Access Tokens (PATs) in Azure DevOps are retired. To keep publishing extensions, use secure automated publishing with Microsoft Entra ID instead of PATs."

That is roughly eight weeks away, so **publish before then**. The replacement path is not practical for one person working locally:

| Path | What it needs | Verdict |
| --- | --- | --- |
| Personal Access Token | A token from the Azure DevOps portal | Five minutes. Works until 1 Dec 2026 |
| Microsoft Entra ID with workload identity federation | Azure DevOps service connections, a user-assigned managed identity in Azure, federated credentials, Azure Pipelines, `vsce publish --azure-credential` | Built for CI pipelines and a company with an Azure subscription. Not worth it for a solo extension |

So: use a PAT now. If the extension is still maintained after December, either move publishing into a GitHub Actions pipeline with a federated identity, or wait and see whether Microsoft ships a simpler interactive login.

## What is already in place

| Item | State |
| --- | --- |
| Public repo | https://github.com/Michael-Obele/nkana |
| `publisher` field | `michael-obele`, already set in `package.json` |
| Publisher ID free? | Yes. `marketplace.visualstudio.com/publishers/michael-obele` returns 404, so nobody has taken it. `nkana` and `sveltecore` are free too |
| Existing extension named `nkana`? | No |
| npm name `nkana` | Free (404) |
| `LICENSE` | MIT, present |
| `README.md` | Present, and the Marketplace renders it |
| `CHANGELOG.md` | Present |
| `.vscodeignore` | Present, excludes `.git`, `install.sh`, `skills.json` and `*.vsix` |
| `@vscode/vsce` | Not installed yet |

## Steps

### 1. Create the publisher

1. Go to https://marketplace.visualstudio.com/manage/publishers/ and sign in with the Microsoft account you want to own this.
2. Choose **Create publisher**.
3. Set **ID** to `michael-obele` and a display **Name** (your name, or SvelteCore Systems Ltd).
4. The ID cannot be changed later, so get it right the first time.

### 2. Create a Personal Access Token

1. Sign in to https://dev.azure.com with the **same** Microsoft account.
2. Open the user settings menu next to your profile picture, then **Personal access tokens**, then **New Token**.
3. Set:
   - **Organization**: `All accessible organizations`. Picking a single organization is the most common cause of a 403 later.
   - **Scopes**: choose **Custom defined**, click **Show all scopes**, scroll to **Marketplace** and tick **Manage**.
4. Create it and copy the token. Azure shows it once.

### 3. Log in and publish

```bash
npx @vscode/vsce login michael-obele     # paste the PAT when prompted
npx @vscode/vsce package                 # writes nkana-0.2.0.vsix
npx @vscode/vsce publish                 # uploads and publishes
```

`vsce publish` needs a clean working tree and the version in `package.json` to be higher than what is already published.

### 4. Check it

The listing appears at `https://marketplace.visualstudio.com/items?itemName=michael-obele.nkana` within a few minutes. Then confirm a real install works:

```bash
code --install-extension michael-obele.nkana
```

## Two things to expect

**The published extension starts with no skills.** The tool list is static JSON in the manifest, so a package cannot know your skills in advance. A fresh install shows the "no skills registered yet" prompt, which offers to run `Nkana: Scan skills`. That writes the list and asks for a reload. This is the one rough edge of the design, and it disappears if upstream ever stabilises the `registerToolDefinition` API.

**Do not install the `.vsix` over your local working copy.** Both use the same folder path, so it would replace the working install with an empty tool list. Test a `.vsix` on a different machine, or delete and reinstall from source afterwards.

## If something goes wrong

| Symptom | Cause |
| --- | --- |
| 403 Forbidden or 401 Unauthorized | The PAT was scoped to one organization instead of **All accessible organizations**, or the scope is not **Marketplace (Manage)** |
| `vsce` cannot find the publisher | The publisher ID in `package.json` does not match the one you logged in with |
| The extension installs but `#` shows nothing | Run `Nkana: Scan skills`, then reload the window |
| A skill is missing from the `#` list | Its name collides with a built-in tool, or it duplicates another skill folder. `generate.js` prints what it skipped |

## Afterwards

- Bump `version` in `package.json` and rename the installed folder to match, since VS Code puts the version in the folder name.
- Add a `CHANGELOG.md` entry for each release.
- Consider publishing to Open VSX as well (`npx ovsx publish`) so VSCodium and other non-Microsoft builds can install it.
