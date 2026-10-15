# paper_garden

*[中文说明](README.zh-CN.md)*

A [Quartz](https://quartz.jzhao.xyz/) v5 fork that publishes a **public reading
site** from a **private notes vault**.

Two repositories, one boundary:

- **private source** — your notes and the publish config (never public);
- **this repo** — the site itself: theme, plugins, export/audit scripts.

No notes live here. At build time, approved notes are copied into a temporary
directory, rendered, audited, and only then published.

## How it works

1. **Export** — copy only approved notes out of the source into a fresh staging
   directory; strip private metadata, local links and personal sections; keep
   only the images those notes reference.
2. **Build** — Quartz renders the staged directory.
3. **Audit** — scan the finished site (pages, index, feeds, filenames, assets)
   and fail the build if anything unexpected is present.

Conservative by design: anything unrecognised stops publication for review.

## Plugins

| Plugin | Role |
| --- | --- |
| `literature-index` | landing page and tag/filter navigation |
| `reading-fit` | reading layout for figures, tables, lists, TOC, callouts |
| `privacy-filter` | drops legacy private sections and unsafe links at render time |

## Quick start

Requires Node 22+.

```bash
npm ci
npx quartz plugin install

PRIVATE_SOURCE_PATH=/path/to/source \
PUBLISHING_CONFIG=/path/to/config \
  ./setup.sh
```

Then open <http://127.0.0.1:8080>. `setup.sh` exports the approved subset,
builds it and serves it; the source vault is never used as the content directory.

## Privacy

Private data (paths, selection, vocabulary, service settings) stays outside this
repository in ignored local files. Only the theme, plugins and scripts are
public, together with the audited static site built from approved notes.

## Deploy

See [DEPLOY.md](DEPLOY.md).

## Upstream

A fork of [jackyzha0/quartz](https://github.com/jackyzha0/quartz) (branch `v5`).
Track upstream with:

```bash
git fetch upstream
git rebase upstream/v5
```

MIT licensed — see [LICENSE.txt](LICENSE.txt).
