# Public literature site deployment

The public repository contains the Quartz theme and the publication exporter. It does not contain the Obsidian vault or private notes.

## Build boundary

CI checks out the private source into `.vault-source`, reads its private `.scripts/publishing.yaml`, and exports only the explicitly selected literature notes into a fresh `$RUNNER_TEMP/publication/content` directory. Keeping staging outside the checkout prevents Quartz's Git ignore rules from hiding the approved inputs. The exporter:

- requires a source URL or DOI and places the original/code links first;
- removes local Zotero links, private metadata, private sections and non-public tags; rejects unapproved wiki links;
- copies only images referenced by approved notes;
- records a private build manifest and rejects symlinks, credentials, local paths, unsafe URLs, and unexpected files.

Quartz builds only the exported directory. The final HTML, content index, RSS, sitemap, links, and assets are audited before the Pages artifact is uploaded.

Maintain the single private config on the source side. `workflow.py snapshot`
(or `workflow.py publish`) generates `.scripts/publishing.yaml` inside the private
vault for CI. Do not edit that generated snapshot by hand. Its shape is:

```yaml
garden:
  title: Research Notes
  base_url: https://example.org/papers
  include:
    - 02-Literature/ZoteroNotes/example-paper.md
    - 02-Literature/WebNotes/example-article.md
  sources: {}
privacy:
  require_terms: true
  terms: []       # maintain privately; never commit it to this repository
  private_hosts: []
```

Copy `shared/config/workflow-config.example.yaml` from `ai-workflows` when setting up the source side, and set `garden.repo` to this checkout. Keep account names, project vocabulary, collection IDs, local paths, and tokens in private configuration or GitHub Secrets.

## Workflow inputs

Set the repository variable `PRIVATE_SOURCE_REPOSITORY` and the secret `OBSIDIAN_PAT` in the public repository. The private source repository can trigger `deploy.yml` through its own workflow using a short lived dispatch token. The checked-in workflow also supports manual dispatch.

For a local build, use a copy of the private vault and run:

```bash
npm ci
node scripts/publication.mjs export \
  --config /path/to/vault/.scripts/publishing.yaml \
  --source /path/to/vault \
  --output /tmp/public-content \
  --overlay content-extras \
  --quartz-config /tmp/public-quartz.config.yaml
QUARTZ_CONFIG_PATH=/tmp/public-quartz.config.yaml \
  npx quartz build -d /tmp/public-content
node scripts/publication.mjs audit \
  --config /path/to/vault/.scripts/publishing.yaml \
  --content /tmp/public-content --output public
```

`content/` remains ignored and is never a publication input. A failed export or artifact audit blocks deployment. The audit also verifies that
source/code opening links survived rendering, reviewed image hashes match, and
no stale/unapproved pages or private ledger files entered the artifact. Paper
images require the private figure ledger described by the source note contract;
remote images must first become reviewed local assets.
