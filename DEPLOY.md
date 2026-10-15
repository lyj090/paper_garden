# Deployment

This repository ships the Quartz theme and the publication pipeline. It holds no
notes and no private data.

## Build boundary

CI checks the private source out into a staging path, reads its publish config,
and exports only the explicitly selected notes into a fresh temporary directory.
Keeping staging outside the checkout stops Quartz's Git ignore rules from hiding
the approved inputs. The exporter:

- requires a source URL or DOI and places the original/code links first;
- removes local library links, private metadata, private sections and
  non-public tags, and rejects unapproved wiki links;
- copies only images referenced by approved notes;
- records a private build manifest and rejects symlinks, credentials, local
  paths, unsafe URLs and unexpected files.

Quartz builds only the exported directory. The final HTML, content index, RSS,
sitemap, links and assets are audited before the artifact is uploaded.

Maintain a single private config on the source side. The toolkit's publish
command generates the CI snapshot from it; do not edit that snapshot by hand.
Its shape:

```yaml
garden:
  title: Reading Notes
  base_url: https://example.org
  include:
    - notes/example-note.md
    - feeds/example-clip.md
  sources: {}
privacy:
  require_terms: true
  terms: []          # maintain privately; never commit it here
  private_hosts: []
```

Keep account names, project vocabulary, collection IDs, local paths and tokens
in private configuration or GitHub Secrets.

## Workflow inputs

Set the repository variable `PRIVATE_SOURCE_REPOSITORY` and the secret
`OBSIDIAN_PAT` in this repository. The private source repository can trigger
`deploy.yml` from its own workflow with a short lived dispatch token. The
checked-in workflow also supports manual dispatch.

For a local build against a copy of the private source:

```bash
npm ci
node scripts/publication.mjs export \
  --config /path/to/publish-config.yaml \
  --source /path/to/source \
  --output /tmp/public-content \
  --overlay content-extras \
  --quartz-config /tmp/public-quartz.config.yaml
QUARTZ_CONFIG_PATH=/tmp/public-quartz.config.yaml \
  npx quartz build -d /tmp/public-content
node scripts/publication.mjs audit \
  --config /path/to/publish-config.yaml \
  --content /tmp/public-content --output public
```

`content/` stays ignored and is never a publication input. A failed export or
audit blocks deployment. The audit also verifies that source/code opening links
survived rendering, that reviewed image hashes match, and that no stale or
unapproved pages or private ledgers entered the artifact.
