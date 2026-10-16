import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { exportContent, auditArtifact, checkText, checkUrl, stripLegacy, cutAtPrivateMarker, desensitizeBody } from './publication.mjs'

const hash = (b) => crypto.createHash('sha256').update(b).digest('hex')
const cfg = { garden: { include: ['02-Literature/ZoteroNotes/paper.md'] }, privacy: { require_terms: true, terms: ['synthetic-private-canary'] } }
async function fixture(t, body = '## 原文与代码\n- [原文](https://example.org/paper)\n\n## Method\n![Figure 3. Result](assets/panel.png)\n') {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'publication-test-'))
  t.after(() => fs.rm(tmp, { recursive: true, force: true }))
  const source = path.join(tmp, 'vault'), dir = path.join(source, '02-Literature/ZoteroNotes')
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true })
  const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'white' } }).png().toBuffer()
  await fs.writeFile(path.join(dir, 'assets/panel.png'), image)
  await fs.writeFile(path.join(dir, 'assets/orphan.png'), image)
  const ledger = { schema: 2, source_pdf_sha256: 'a'.repeat(64), assets: [{ filename: 'panel.png', sha256: hash(image), figures: ['3'], status: 'verified', evidence: { page: 2, method: 'rendered-pdf-visual-comparison' } }] }
  await fs.writeFile(path.join(dir, 'assets/figure-ledger.json'), JSON.stringify(ledger))
  await fs.writeFile(path.join(dir, 'paper.md'), '---\ntitle: Paper\nnote_contract: 2\nurl: https://example.org/paper\nzotero_key: ITEM0001\ntags: [type/paper, rel/private]\n---\n\n' + body)
  const config = path.join(tmp, 'config.json'); await fs.writeFile(config, JSON.stringify(cfg))
  const opts = { config, source, output: path.join(tmp, 'stage') }
  return { tmp, dir, ledger, opts }
}
async function artifact(f) {
  await exportContent(f.opts)
  const output = path.join(f.tmp, 'public')
  await fs.mkdir(path.join(output, 'static'), { recursive: true })
  const manifest = JSON.parse(await fs.readFile(path.join(f.opts.output, '.publication-manifest.json'), 'utf8'))
  for (const slug of manifest.notes) { const file = path.join(output, slug + '.html'); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, '<html><article><h2>原文与代码</h2><a href="https://example.org/paper">Original</a><h2>Method</h2><p>Paper</p></article></html>') }
  for (const asset of manifest.files.filter((f) => !f.file.endsWith('.md'))) {
    const target = path.join(output, asset.file.toLowerCase()); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(path.join(f.opts.output, asset.file), target)
  }
  await fs.writeFile(path.join(output, 'static/contentIndex.json'), JSON.stringify(Object.fromEntries(manifest.notes.map((s) => [s, { links: [] }]))))
  return { config: f.opts.config, content: f.opts.output, output }
}

test('encoded private text and unsafe URLs fail without echoing matched data', () => {
  for (const text of ['synthetic-private-canary', '%73ynthetic-private-canary', '&#115;ynthetic-private-canary', 'file:///tmp/a', '/home/someone/data', 'zotero://select/a']) assert.throws(() => checkText(text, cfg))
  for (const text of ['- Zotero Item ID: 492', 'Zotero collection: `01_Thesis / Manipulation`', 'Written by LLM-for-Zotero.']) assert.throws(() => checkText(text, cfg))
  for (const url of ['https://user:pass@example.org', 'http://127.0.0.1/a', 'https://internal/a', 'https://example.org/?access_token=x', 'https://10.0.0.1', 'https://[::1]/a']) assert.throws(() => checkUrl(url, cfg))
  assert.doesNotThrow(() => checkUrl('https://doi.org/10.0000/example', cfg))
})
test('local-library bookkeeping is stripped from the publishable body', () => {
  const body = [
    '## 文献信息', '- **Zotero Item ID**: 492', '- **标题**: A paper',
    '## 推荐 Zotero Tags', '- event-based-vision', '- visual-tracking',
    '## 正文', '真实内容（Zotero attachment: arXiv:2203.15103）.',
    'Written by LLM-for-Zotero.',
  ].join('\n')
  const out = desensitizeBody(body)
  assert.doesNotMatch(out, /Zotero Item ID|推荐 Zotero Tags|LLM-for-Zotero|event-based-vision|Zotero attachment/i)
  assert.match(out, /真实内容/)
  assert.match(out, /## 正文/)
})
test('a private heading truncates through later public-looking headings; fenced examples survive', () => {
  assert.equal(stripLegacy('## Method\nEvidence\n## 9. 我的判读\nprivate\n## Results\nprivate'), '## Method\nEvidence')
  assert.match(stripLegacy('```md\n## 我的判断\n```\n## Method\nEvidence'), /Evidence/)
})
test('an explicit private divider hides everything below it, whatever the heading', () => {
  const body = '## Method\nEvidence\n\n<!-- private -->\n\n## 10. Evidence boundaries\nlocal only\n'
  assert.equal(stripLegacy(body), '## Method\nEvidence')
  assert.equal(stripLegacy('## Method\nEvidence\n\n<<< private >>>\n## 10. Anything\nx'), '## Method\nEvidence')
  // A note that only documents the marker inside a fence must not be cut.
  assert.match(cutAtPrivateMarker('```md\n<!-- private -->\n```\n## Results\nEvidence'), /Evidence/)
  assert.equal(cutAtPrivateMarker('## Results\nEvidence'), '## Results\nEvidence')
})
test('export keeps only referenced images and public metadata', async (t) => {
  const f = await fixture(t); const r = await exportContent(f.opts)
  assert.equal(r.assets, 1)
  const text = await fs.readFile(path.join(f.opts.output, '02-Literature/ZoteroNotes/paper.md'), 'utf8')
  assert.doesNotMatch(text, /ITEM0001|rel\/private/)
  await assert.rejects(fs.access(path.join(f.opts.output, '02-Literature/ZoteroNotes/assets/orphan.png')))
  await assert.rejects(fs.access(path.join(f.opts.output, '02-Literature/ZoteroNotes/assets/figure-ledger.json')))
})
test('content below the private divider never reaches the staged output', async (t) => {
  const body = '## 原文与代码\n- [原文](https://example.org/paper)\n\n## Method\n![Figure 3. Result](assets/panel.png)\n\n<!-- private -->\n\n## 10. Evidence boundaries\nlocal-only-review-note\n'
  const f = await fixture(t, body)
  await exportContent(f.opts)
  const text = await fs.readFile(path.join(f.opts.output, '02-Literature/ZoteroNotes/paper.md'), 'utf8')
  assert.match(text, /## Method/)
  assert.doesNotMatch(text, /Evidence boundaries|local-only-review-note|<!-- private -->/)
})
test('a changed image invalidates its review', async (t) => {
  const f = await fixture(t)
  await fs.writeFile(path.join(f.dir, 'assets/panel.png'), Buffer.from('changed'))
  await assert.rejects(exportContent(f.opts), /figure-review-required/)
})
test('a wrong printed figure number is blocked even when the filename looks correct', async (t) => {
  const f = await fixture(t, '![Figure 6. Wrong identity](assets/panel.png)')
  await assert.rejects(exportContent(f.opts), /figure-review-required/)
})
test('table, algorithm and roman identities round-trip', async (t) => {
  for (const [figures, alt] of [[['Table 1'], 'Table 1. Scores'], [['Algorithm 1'], 'Algorithm 1. Training'], [['Table IV'], 'Table IV. Config'], [['B.3'], 'Figure B.3. Appendix']]) {
    const f = await fixture(t, `![${alt}](assets/panel.png)`)
    f.ledger.assets[0].figures = figures
    await fs.writeFile(path.join(f.dir, 'assets/figure-ledger.json'), JSON.stringify(f.ledger))
    await exportContent(f.opts)
  }
})
test('a table image published under a figure label is blocked', async (t) => {
  const f = await fixture(t, '![Figure 1. Wrong kind](assets/panel.png)')
  f.ledger.assets[0].figures = ['Table 1']
  await fs.writeFile(path.join(f.dir, 'assets/figure-ledger.json'), JSON.stringify(f.ledger))
  await assert.rejects(exportContent(f.opts), /figure-review-required/)
})
test('remote images and private wiki links require review', async (t) => {
  const f = await fixture(t, '![](https://example.org/image.png)')
  await assert.rejects(exportContent(f.opts), /remote-image/)
  await fs.writeFile(path.join(f.dir, 'paper.md'), '---\ntitle: Paper\nurl: https://example.org\n---\n[[01-Projects/Private Project|innocent label]]')
  await assert.rejects(exportContent(f.opts), /unapproved-wiki-link/)
})
test('asset symlinks cannot escape the vault', async (t) => {
  const f = await fixture(t)
  await fs.unlink(path.join(f.dir, 'assets/panel.png'))
  await fs.symlink(path.join(f.tmp, 'config.json'), path.join(f.dir, 'assets/panel.png'))
  await assert.rejects(exportContent(f.opts), /source-symlink-escape/)
})
test('unrelated private documents are never publication candidates', async (t) => {
  const f = await fixture(t)
  await fs.mkdir(path.join(f.opts.source, '01-Projects'))
  await fs.symlink('/nonexistent/private/file', path.join(f.opts.source, '01-Projects/secret.md'))
  await exportContent(f.opts)
})
test('staged tampering is rejected after the build', async (t) => {
  const f = await fixture(t); const opts = await artifact(f)
  await auditArtifact(opts)
  await fs.appendFile(path.join(f.opts.output, '02-Literature/ZoteroNotes/paper.md'), '\nchanged')
  await assert.rejects(auditArtifact(opts), /staged-file-changed/)
})
test('unexpected pages, archives and private ledgers block final output', async (t) => {
  const f = await fixture(t); const opts = await artifact(f)
  for (const file of ['private.html', 'archive.zip', 'figure-ledger.json', '.env']) {
    await fs.writeFile(path.join(opts.output, file), 'hidden')
    await assert.rejects(auditArtifact(opts))
    await fs.unlink(path.join(opts.output, file))
  }
  await fs.writeFile(path.join(opts.output, 'static/contentIndex.json'), JSON.stringify({ 'private/index': { links: [] } }))
  await assert.rejects(auditArtifact(opts), /unexpected-index-page/)
})

test('a renderer cannot silently remove the original-source opening links', async (t) => {
  const f = await fixture(t); const opts = await artifact(f)
  const file = path.join(opts.output, '02-literature/zoteronotes/paper.html')
  await fs.writeFile(file, '<article><h2>原文与代码</h2><h2>Method</h2><p>Paper</p></article>')
  await assert.rejects(auditArtifact(opts), /rendered-source-link-missing/)
})

test('missing published images and hidden symlink directories are rejected', async (t) => {
  const f = await fixture(t); const opts = await artifact(f)
  const asset = path.join(opts.output, '02-literature/zoteronotes/assets/panel.png')
  const bytes = await fs.readFile(asset); await fs.unlink(asset)
  await assert.rejects(auditArtifact(opts), /approved-asset-missing/)
  await fs.writeFile(asset, bytes)
  await fs.symlink(f.opts.source, path.join(opts.output, 'escaped-directory'))
  await assert.rejects(auditArtifact(opts), /artifact-symlink/)
})

test('an authored opening must contain the known original-source URL', async (t) => {
  const f = await fixture(t, '## 原文与代码\n- [Unrelated](https://example.org/other)\n## Method\nEvidence')
  await assert.rejects(exportContent(f.opts), /source-opening-metadata-mismatch/)
})

test('vault-internal check directives are dropped, not published as raw HTML', async (t) => {
  // A line the private isolation guard waives carries a `<!-- check:... -->`
  // directive. It is a control comment, so export must strip it rather than
  // reject the note as unreviewed raw HTML — and it must not reach the output.
  const body = '## 原文与代码\n- [原文](https://example.org/paper)\n\n## Method\n![Figure 3. Result](assets/panel.png) <!-- check:isolation-ok: paper hardware -->\n'
  const f = await fixture(t, body)
  await exportContent(f.opts)
  const staged = await fs.readFile(path.join(f.opts.output, '02-Literature/ZoteroNotes/paper.md'), 'utf8')
  assert.doesNotMatch(staged, /check:isolation-ok/)
  assert.match(staged, /Figure 3/)
  assert.equal(stripLegacy('## Method\nx <!-- check:publish-isolation allow-concepts -->\ny'), '## Method\nx\ny')
})

test('a colon in a note title resolves to the same slug Quartz emits', async (t) => {
  // Quartz drops Windows-reserved characters when it slugs a path, so a note
  // titled "AMP: ..." is served at ".../amp-..." while a naive exporter would
  // expect ".../amp:-...". Emitted slugs must match Quartz's own slugify.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'publication-colon-'))
  t.after(() => fs.rm(tmp, { recursive: true, force: true }))
  const source = path.join(tmp, 'vault'), dir = path.join(source, '02-Literature/ZoteroNotes')
  const slug = 'note-with-a-colon: subtitle'
  await fs.mkdir(path.join(dir, 'assets', slug.toLowerCase().replace(/: /, '-')), { recursive: true })
  await fs.writeFile(path.join(dir, slug + '.md'),
    '---\ntitle: "Note: Subtitle"\nnote_contract: 2\nurl: https://example.org/paper\ntags: [type/paper]\n---\n\n## 原文与代码\n- [原文](https://example.org/paper)\n\n## Method\nBody\n')
  const out = path.join(tmp, 'out')
  const config = path.join(tmp, 'config.json')
  await fs.writeFile(config, JSON.stringify({ garden: { include: ['02-Literature/ZoteroNotes/' + slug + '.md'] }, privacy: { require_terms: true, terms: ['canary'] } }))
  const ok = await exportContent({ config, source, output: out })
  const manifest = JSON.parse(await fs.readFile(path.join(out, '.publication-manifest.json'), 'utf8'))
  assert.ok(ok.notes >= 1)
  const slugs = await fs.readdir(path.join(out, '02-Literature/ZoteroNotes'))
  assert.ok(slugs.includes(slug + '.md'))
  assert.ok(manifest.allowedSlugs.includes('02-literature/zoteronotes/note-with-a-colon-subtitle'))
})

test('the secret detector does not flag "sk-" inside an ordinary word', async (t) => {
  // "...task-from-one-shot..." contains "sk-" but is not an API key.
  assert.doesNotThrow(() => checkText('3.3 Compose: performing a task-from-one-shot-prompt', cfg))
  assert.throws(() => checkText('token sk-' + 'a'.repeat(30), cfg), /credential-signature/)
})

test('TeX parentheses and brackets inside math are not read as links', async (t) => {
  const f = await fixture(t, '## 原文与代码\n- [原文](https://example.org/paper)\n\n## Method\n\n$$\nL_t(\\theta) = S[\\pi_\\theta](s_t) + c_1 (x)\n$$\n\nInline $f(x)$ and $g[y]$ stay intact.\n')
  await exportContent(f.opts)
  const outp = await fs.readFile(path.join(f.opts.output, '02-Literature/ZoteroNotes/paper.md'), 'utf8')
  assert.match(outp, /S\[\\pi_\\theta\]\(s_t\)/)
  assert.match(outp, /Inline \$f\(x\)\$/)
})
