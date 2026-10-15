# paper_garden

A [Quartz](https://quartz.jzhao.xyz/) v5 fork that publishes a **public literature
site** from a **private Obsidian vault**.

This repository is the public half of a two-repository setup. It contains only
the theme, a few custom Quartz plugins, and the Node export/audit scripts. It
holds **no notes and no private data** — the notes live in a separate private
vault and are copied into a temporary directory only during a build.

```text
private Obsidian vault                     this repository (public)
┌───────────────────────┐   push note   ┌────────────────────────────┐
│ 02-Literature/…       │ ───────────►  │ scripts/publication.mjs    │
│ .scripts/publishing   │   trigger     │   export → stage → audit   │
└───────────────────────┘               │ quartz build (GitHub Pages)│
                                        └────────────────────────────┘
```

## What this is for

I use this to keep a personal, in-progress literature vault private while
publishing a reviewed subset of it as a readable website for others. The
pipeline enforces that boundary:

1. **Export** — `scripts/publication.mjs export` reads a private config inside
   the vault and copies only explicitly approved notes (or notes with
   `publish: true` and `note_contract: 2`) into a fresh staging directory. It
   strips local `zotero://` shortcuts, private metadata, personal sections and
   non-public tags, and copies only the images those notes actually reference.
2. **Build** — Quartz renders the staged directory. The vault is never Quartz's
   content directory.
3. **Audit** — `scripts/publication.mjs audit` scans the finished HTML, content
   index, sitemap, RSS, filenames and assets. It verifies that source links
   survived rendering, that reviewed image hashes match, and that no unexpected
   pages, archives, symlinks or private files entered the artifact. A failed
   audit blocks deployment.

Publication is deliberately conservative: anything unrecognised stops the build
for review instead of shipping.

## Custom plugins

| Plugin | Purpose |
| --- | --- |
| `plugins/literature-index` | Landing page and tag/filter navigation for the literature partition |
| `plugins/reading-fit` | Reading-layout fixes for figures, tables, lists, TOC and callouts |
| `plugins/privacy-filter` | Removes legacy private sections and unsafe links at render time |

## Quick start

Requires Node 22+ and its locked npm dependencies.

```bash
npm ci
npx quartz plugin install

# Local preview from a private vault and its generated publishing config:
PRIVATE_SOURCE_PATH=/path/to/vault \
PUBLISHING_CONFIG=/path/to/vault/.scripts/publishing.yaml \
  ./setup.sh
```

`setup.sh` exports the approved subset, builds it and serves it on
`http://127.0.0.1:8080`. It never reads the vault as Quartz's content directory.

## Privacy model

Private information (vault path, selection list, private vocabulary, Zotero
settings) lives **outside this repository** in a git-ignored local config
(`*.local.yaml`, `.vault-source/`, `.publication/`). Only two things cross into
this public repository:

- the theme, plugins and scripts;
- the built, audited static site, which contains just the approved notes.

Reviewed paper figures are validated against a private, hash-bound figure
ledger stored with the notes; the ledger itself is never published.

## Deployment

See [DEPLOY.md](DEPLOY.md). CI checks the repository variable
`PRIVATE_SOURCE_REPOSITORY` and the secret `OBSIDIAN_PAT`, exports and audits
the approved content, then uploads the artifact to GitHub Pages.

## Relationship to upstream

This is a fork of **[jackyzha0/quartz](https://github.com/jackyzha0/quartz)**
(branch `v5`). It tracks upstream and rebases local changes on top of it:

```bash
git fetch upstream
git rebase upstream/v5
```

Upstream Quartz documentation: <https://quartz.jzhao.xyz/>.
Licensed under the MIT License, see [LICENSE.txt](LICENSE.txt).
