#!/usr/bin/env node
/** Export explicitly selected sources, then audit the complete web artifact.
 * This module is intentionally free of machine/account/project identifiers.
 * Private config is read from outside the exported content directory.
 */
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"
import { isIP } from "node:net"
import YAML from "yaml"
import { globby } from "globby"
import { unified } from "unified"
import remarkParse from "remark-parse"
import sharp from "sharp"

export const PERSONAL_HEADING = /^(?:\d+[.、]\s*)?(?:项目关联(?:与本笔记判读)?|本笔记判读|我的(?:判读|判断|批注|理解|启发|看法|评价)|私人笔记|Personal Notes|My Notes)(?:\s|[:：（(]|$)/i
// An explicit divider marking where publishable content ends. Everything from
// this marker to EOF is private by construction: review notes, reproduction
// caveats, local context. Unlike PERSONAL_HEADING it needs no keyword match, so
// it also hides sections whose title looks like ordinary paper content.
export const PRIVATE_MARKER = /^\s*(?:<!--\s*private\b[^>]*-->\s*|<<<\s*private\s*>>>)\s*$/i
// Vault-internal review directives such as `<!-- check:isolation-ok: ... -->`
// are control comments consumed by the private isolation guard, not content.
// Strip them at export so the guard can waive an in-paper line without the
// directive itself reaching the public artifact (where it would look like
// unreviewed raw HTML).
export const INTERNAL_DIRECTIVE = /[ \t]*<!--\s*check:[^>]*?-->/gi
// Local tooling bookkeeping (Zotero item/collection ids, "written by" footers,
// tag suggestions). It describes the private library, not the paper, so it is
// removed from the publishable body rather than published or left to fail the
// export on a per-note basis.
const LOCAL_TOOLING_LINE = /^\s*(?:[-*+>]\s*)?(?:\*{0,2})(?:Zotero (?:Item|item) ID|Zotero Key|Zotero collection|Zotero attachment|Written to Obsidian by LLM-for-Zotero|Written by LLM-for-Zotero)(?:\*{0,2})\s*[:：]?\s*.*$/gim
const LOCAL_TOOLING_INLINE = /\s*[（(]Zotero attachment:[^)）]*[)）]\.?/gi
const LOCAL_TOOLING_SECTION = /^(?:推荐\s*)?Zotero\s*Tags\s*$/i
export function desensitizeBody(body) {
  body = body.replace(LOCAL_TOOLING_INLINE, "")
  body = body.replace(LOCAL_TOOLING_LINE, "")
  const lines = body.split(/\r?\n/)
  const keep = []
  let fence = null
  let skipDepth = null
  for (const line of lines) {
    const fenceMark = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fenceMark) {
      if (!fence) fence = fenceMark[1]
      else if (fenceMark[1][0] === fence[0] && fenceMark[1].length >= fence.length) fence = null
      if (skipDepth === null) keep.push(line)
      continue
    }
    const heading = !fence && /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const depth = heading[1].length
      if (skipDepth !== null && depth <= skipDepth) skipDepth = null
      if (skipDepth === null && LOCAL_TOOLING_SECTION.test(heading[2].trim())) { skipDepth = depth; continue }
    }
    if (skipDepth === null) keep.push(line)
  }
  return keep.join("\n").replace(/\n{3,}/g, "\n\n")
}
const PRIVATE_SCHEME = /(?:zotero|obsidian|file):\/\//i
const LOCAL_PATH = /(?:\/home\/|\/Users\/|[A-Z]:\\Users\\)/i
const INTERNAL_CONTEXT = /当前项目|我的项目|本地项目|我们的项目|我们项目/
const INTERNAL_LIBRARY = /Zotero Item ID|Zotero Key|Zotero collection|Zotero attachment|LLM-for-Zotero/i
const TOKEN = /(?<![A-Za-z])(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|ntn_[A-Za-z0-9]{25,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/
const NAMESPACES = new Set(["type", "area", "topic", "method", "task", "software", "hardware"])
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"])
const parser = unified().use(remarkParse)
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex")

// remark-parse without remark-math leaves TeX between `$`/`$$` as ordinary text.
// Parentheses or brackets there (`S[\pi](s_t)`, `f(x)`) can then look like a
// markdown link and get rejected as an unapproved/unsafe link. Blank out math
// spans with spaces of identical length so node offsets still line up, while
// code fences and genuine links are untouched.
export function maskMath(md) {
  const lines = md.split("\n")
  let fence = null
  let display = false
  const out = []
  for (const line of lines) {
    const fenceMark = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fenceMark && !display) {
      if (!fence) fence = fenceMark[1]
      else if (fenceMark[1][0] === fence[0] && fenceMark[1].length >= fence.length) fence = null
      out.push(line)
      continue
    }
    if (fence) {
      out.push(line)
      continue
    }
    let res = ""
    let i = 0
    while (i < line.length) {
      if (display) {
        const end = line.indexOf("$$", i)
        if (end === -1) { res += " ".repeat(line.length - i); i = line.length; break }
        res += " ".repeat(end - i + 2); i = end + 2; display = false; continue
      }
      if (line.startsWith("$$", i)) { res += "  "; i += 2; display = true; continue }
      if (line[i] === "$") {
        const end = line.indexOf("$", i + 1)
        if (end !== -1) { res += " ".repeat(end - i + 1); i = end + 1; continue }
      }
      res += line[i]; i += 1
    }
    out.push(res)
  }
  return out.join("\n")
}

function fail(code) {
  // Do not interpolate source filenames, URLs or private terms into CI output.
  throw new Error(code)
}
function walk(node, fn) {
  fn(node)
  for (const child of node.children ?? []) walk(child, fn)
}
function textOf(node) {
  return node.value ?? (node.children ?? []).map(textOf).join("")
}
function decoded(s) {
  let out = String(s).normalize("NFKC")
  for (let i = 0; i < 3; i++) {
    out = out.replace(/&#(?:x([a-f0-9]+)|(\d+));?/gi, (_, h, d) => {
      const n = parseInt(h ?? d, h ? 16 : 10)
      return n <= 0x10ffff ? String.fromCodePoint(n) : ""
    }).replace(/&colon;/gi, ":").replace(/&sol;/gi, "/").replace(/&amp;/gi, "&")
    try { out = decodeURIComponent(out) } catch { /* inspect undecodable text as-is */ }
  }
  return out
}
function decodePath(s) {
  try { return decodeURIComponent(String(s)) } catch { return String(s) }
}
export function checkText(text, cfg) {
  const value = decoded(text)
  if (PRIVATE_SCHEME.test(value)) fail("private-uri")
  if (LOCAL_PATH.test(value)) fail("local-path")
  if (TOKEN.test(value)) fail("credential-signature")
  if (INTERNAL_CONTEXT.test(value)) fail("personal-context")
  if (INTERNAL_LIBRARY.test(value)) fail("local-library-context")
  for (const term of cfg.privacy?.terms ?? []) {
    if (value.toLowerCase().includes(decoded(term).toLowerCase())) fail("private-vocabulary")
  }
}
export function checkUrl(raw, cfg) {
  const value = decoded(raw)
  if (value.startsWith("#")) return
  if (!/^https?:\/\//i.test(value)) fail("non-public-url")
  let u
  try { u = new URL(value) } catch { fail("invalid-url") }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  // Numeric hosts and intranet names are not useful public paper references.
  if (u.username || u.password || !host.includes(".") || isIP(host) ||
      /\.(?:local|internal|localhost)$/.test(host) ||
      (cfg.privacy?.private_hosts ?? []).some((h) => host === h || host.endsWith("." + h))) fail("private-host")
  for (const key of u.searchParams.keys()) {
    if (/token|secret|key|auth|password|signature|credential|email/i.test(key)) fail("sensitive-url-query")
  }
  checkText(value, cfg)
}
function within(root, candidate) {
  const rel = path.relative(root, candidate)
  return rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel)
}
function assertNoSymlinks(root) {
  if (fs.lstatSync(root).isSymbolicLink()) fail("artifact-symlink")
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isSymbolicLink()) fail("artifact-symlink")
    if (entry.isDirectory()) assertNoSymlinks(file)
  }
}

function resolveSource(root, rel) {
  if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) fail("unsafe-source-path")
  const p = fs.realpathSync(path.join(root, rel))
  if (!within(root, p)) fail("source-symlink-escape")
  return p
}
export function splitNote(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!match) fail("frontmatter-missing")
  let fm
  try { fm = YAML.parse(match[1], { uniqueKeys: true }) } catch { fail("frontmatter-invalid") }
  if (!fm || typeof fm !== "object" || Array.isArray(fm)) fail("frontmatter-invalid")
  return { fm, body: text.slice(match[0].length).trimStart() }
}
// Cut at the private divider, ignoring fenced code so a note may document the
// marker itself. Everything from the marker to EOF is dropped.
export function cutAtPrivateMarker(body) {
  const lines = body.split(/\r?\n/)
  let fence = null
  for (let i = 0; i < lines.length; i++) {
    const fenceMark = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[i])
    if (fenceMark) {
      if (!fence) fence = fenceMark[1]
      else if (fenceMark[1][0] === fence[0] && fenceMark[1].length >= fence.length) fence = null
      continue
    }
    if (!fence && PRIVATE_MARKER.test(lines[i])) return lines.slice(0, i).join("\n")
  }
  return body
}
export function stripLegacy(body) {
  // The explicit divider wins over heading heuristics: cut to EOF first.
  body = cutAtPrivateMarker(body)
  // Drop control comments before parsing; they are directives, not content.
  body = body.replace(INTERNAL_DIRECTIVE, "")
  // Drop local-library bookkeeping that is not paper content.
  body = desensitizeBody(body)
  let tree = parser.parse(body)
  const personal = tree.children.find((n) => n.type === "heading" && PERSONAL_HEADING.test(textOf(n).trim()))
  if (personal) body = body.slice(0, personal.position.start.offset)
  tree = parser.parse(body)
  const removals = []
  for (let i = 0; i < tree.children.length; i++) {
    const node = tree.children[i]
    if (node.type === "heading" && textOf(node).trim() === "快捷链接") {
      let j = i + 1
      while (j < tree.children.length && !(tree.children[j].type === "heading" && tree.children[j].depth <= node.depth)) j++
      removals.push([node.position.start.offset, j < tree.children.length ? tree.children[j].position.start.offset : body.length])
    }
  }
  for (const [start, end] of removals.reverse()) body = body.slice(0, start) + body.slice(end)
  return body.trim()
}
function slugify(s) {
  // Must match Quartz's slugifyPath so emitted slugs equal the pages Quartz
  // actually writes. Quartz also strips Windows-reserved characters
  // (<>:"|*), which appear in Obsidian note titles such as "AMP: ...".
  return s.replace(/\.md$/i, "").split("/").map((p) => p.replace(/\s/g, "-").replace(/&/g, "-and-").replace(/%/g, "-percent").replace(/[?#]/g, "").replace(/[<>:"|*]/g, "").toLowerCase()).join("/")
}
function publicFm(fm) {
  const clean = { publication_schema: 2, publish: true }
  for (const field of ["title", "authors", "year", "date", "author", "venue", "doi", "arxiv", "url", "code_url", "project_url", "note_contract"]) {
    if (fm[field] != null && fm[field] !== "") clean[field] = fm[field]
  }
  if (typeof clean.title !== "string" || !clean.title.trim()) fail("title-missing")
  clean.tags = (Array.isArray(fm.tags) ? fm.tags : []).filter((t) => typeof t === "string" &&
    /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)+$/.test(t) && NAMESPACES.has(t.split("/")[0]))
  return clean
}
function opening(body, fm, source, cfg) {
  const supplied = cfg.garden?.sources?.[source] ?? {}
  let url = fm.url ?? fm.source ?? supplied.url
  if (!url && fm.doi) url = "https://doi.org/" + fm.doi
  if (!url && fm.arxiv) url = "https://arxiv.org/abs/" + fm.arxiv
  if (!url) fail("original-source-missing")
  checkUrl(url, cfg)
  const code = fm.code_url ?? supplied.code_url
  const project = fm.project_url ?? supplied.project_url
  for (const u of [code, project].filter(Boolean)) checkUrl(u, cfg)
  if (/^## 原文与代码\s*(?:\n|$)/.test(body)) {
    const urls = []
    for (const node of parser.parse(body).children.slice(1)) {
      if (node.type === "heading") break
      walk(node, (n) => { if (n.type === "link") urls.push(decoded(n.url)) })
    }
    if ([url, code, project].filter(Boolean).some((u) => !urls.includes(decoded(u)))) fail("source-opening-metadata-mismatch")
    return body
  }
  const lines = ["## 原文与代码", `- [原文](${url})`]
  if (project) lines.push(`- [论文主页](${project})`)
  lines.push(code ? `- [官方代码](${code})` : "- 代码链接：未核实")
  return lines.join("\n") + "\n\n" + body
}
function readConfig(config) {
  let cfg
  try { cfg = YAML.parse(fs.readFileSync(config, "utf8")) } catch { fail("configuration-unreadable") }
  if (!cfg || typeof cfg !== "object") fail("configuration-invalid")
  if (cfg.privacy?.require_terms && !(Array.isArray(cfg.privacy.terms) && cfg.privacy.terms.length)) fail("private-vocabulary-required")
  for (const term of cfg.privacy?.terms ?? []) if (typeof term !== "string" || !term.trim()) fail("private-vocabulary-invalid")
  return cfg
}

// A printed asset is usually a Figure, but papers also number Tables,
// Algorithms and Equations, with Arabic or Roman numerals. A bare number means
// Figure, so reviewed ledgers written before this extension stay valid.
const LABEL = /^(Figure|Fig\.|图|Table|Algorithm|Equation|表|算法|式)/i
const IDENT = /^[A-Z]?(?:\.\d+|\d+)(?:\.\d+)?$|^[IVX]+$/i
function canonicalId(label, ident) {
  const kind = (label ?? "fig").toLowerCase().replace(/\.$/, "")
  const group = { figure: "fig", fig: "fig", 图: "fig", table: "table", 表: "table",
    algorithm: "algo", algo: "algo", 算法: "algo", equation: "eq", eq: "eq", 式: "eq" }
  return `${group[kind] ?? "fig"}:${ident.toUpperCase()}`
}
function mentionIds(alt) {
  const ids = []
  for (const m of String(alt ?? "").matchAll(/(Figure|Fig\.|图|Table|Algorithm|Equation|表|算法|式)\s*([A-Z]?(?:\.\d+|\d+)(?:\.\d+)?|[IVX]+)(?![A-Za-z0-9])/gi)) ids.push(canonicalId(m[1], m[2]))
  return ids
}
function ledgerIds(figures) {
  const ids = []
  for (const entry of figures) {
    const text = String(entry).trim()
    const label = LABEL.test(text) ? text.match(LABEL)[1] : null
    const ident = text.replace(LABEL, "").trim()
    if (!IDENT.test(ident)) return null
    ids.push(canonicalId(label, ident))
  }
  return ids
}

function verifyFigure(root, real, alt) {
  let ledger, record
  try {
    ledger = JSON.parse(fs.readFileSync(resolveSource(root, path.relative(root, path.join(path.dirname(real), "figure-ledger.json"))), "utf8"))
    const records = ledger.assets.filter((a) => a.filename === path.basename(real))
    if (records.length !== 1) fail("figure-review-required")
    record = records[0]
  } catch { fail("figure-review-required") }
  const reviewed = Array.isArray(record.figures) && record.figures.length ? ledgerIds(record.figures) : null
  if (ledger.schema !== 2 || !/^[a-f0-9]{64}$/.test(ledger.source_pdf_sha256 ?? "") ||
      record.status !== "verified" || record.sha256 !== sha(fs.readFileSync(real)) ||
      !Number.isInteger(record.evidence?.page) || record.evidence.page < 1 ||
      record.evidence.method !== "rendered-pdf-visual-comparison" ||
      !reviewed ||
      JSON.stringify([...new Set(mentionIds(alt))].sort()) !== JSON.stringify([...new Set(reviewed)].sort())) fail("figure-review-required")
}

export async function exportContent({ config, source, output, overlay, quartzConfig }) {
  const cfg = readConfig(config)
  const root = fs.realpathSync(source)
  const dest = path.resolve(output)
  if (fs.realpathSync(path.dirname(dest)) !== path.dirname(dest)) fail("output-parent-symlink")
  if (within(root, dest) || within(dest, root)) fail("overlapping-source-and-output")
  if (fs.existsSync(dest) || fs.lstatSync(path.dirname(dest)).isSymbolicLink()) fail("output-must-be-fresh")
  const all = await globby("02-Literature/{ZoteroNotes,WebNotes}/**/*.md", { cwd: root, dot: false, followSymbolicLinks: false })
  const selected = new Set(await globby(cfg.garden?.include ?? [], { cwd: root, onlyFiles: true, dot: false, followSymbolicLinks: false }))
  for (const rel of selected) if (!all.includes(rel)) fail("selection-outside-literature-or-symlink")
  // An explicit publish flag is accepted only on the new source-note contract.
  const notes = new Map()
  for (const rel of all) {
    const raw = fs.readFileSync(resolveSource(root, rel), "utf8")
    if (!selected.has(rel) && !/^publish:\s*true\s*$/m.test(raw)) continue
    const { fm, body } = splitNote(raw)
    if (!selected.has(rel) && !(fm.publish === true && fm.note_contract === 2)) continue
    if (fm.draft === true) continue
    if (!/^(?:02-Literature\/(?:ZoteroNotes|WebNotes)\/)/.test(rel)) fail("selection-outside-literature")
    notes.set(rel, { fm, body })
  }
  if (!notes.size) fail("no-approved-notes")
  const slugMap = new Map()
  const titleMap = new Map()
  for (const [rel, { fm }] of notes) {
    const slug = slugify(rel)
    if (slugMap.has(slug)) fail("duplicate-public-slug")
    slugMap.set(slug, rel)
    const title = path.posix.basename(rel, ".md")
    if (titleMap.has(title)) fail("ambiguous-approved-title")
    titleMap.set(title, rel)
    if (fm.title && fm.title !== title && !titleMap.has(fm.title)) titleMap.set(fm.title, rel)
  }
  const sourceLinks = []
  const pending = new Map()
  const assets = new Map()
  let droppedLinks = 0
  for (const [rel, { fm, body }] of notes) {
    const clean = publicFm(fm)
    let md = opening(stripLegacy(body), fm, rel, cfg)
    // Scan a math-masked copy so TeX parentheses are not misread as links; the
    // published `md` keeps its math. Masking preserves offsets, so the wiki-link
    // splice below still applies to the real text.
    const tree = parser.parse(maskMath(md))
    const openingUrls = []
    for (const node of tree.children.slice(1)) {
      if (node.type === "heading") break
      walk(node, (n) => { if (n.type === "link" && /^https?:/.test(n.url)) openingUrls.push(n.url) })
    }
    if (!openingUrls.length) fail("source-opening-link-missing")
    sourceLinks.push({ slug: slugify(rel), urls: openingUrls })
    walk(tree, (node) => {
      if (node.type !== "imageReference") return
      const definition = tree.children.find((n) => n.type === "definition" && n.identifier === node.identifier)
      if (!definition) fail("unresolved-image-reference")
      if (/^https?:/i.test(definition.url)) fail("remote-image-requires-local-review")
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), decodePath(definition.url)))
      if (!IMAGE_EXTENSIONS.has(path.extname(target).toLowerCase())) fail("unsupported-asset-type")
      const real = resolveSource(root, target)
      if (rel.startsWith("02-Literature/ZoteroNotes/")) verifyFigure(root, real, node.alt)
      assets.set(target, real)
    })
    const replacements = []
    walk(tree, (node) => {
      if (node.type === "html") fail("raw-html-requires-review")
      if (node.type === "definition" || node.type === "link" || node.type === "image") {
        const url = node.url ?? ""
        if (/^https?:\/\//i.test(url)) {
          if (node.type === "image" || (node.type === "definition" && tree.children.some((n) => n.type === "imageReference" && n.identifier === node.identifier))) fail("remote-image-requires-local-review")
          checkUrl(url, cfg); return
        }
        if (url.startsWith("#") && node.type !== "image") return
        if (node.type === "image" || (node.type === "definition" && [...assets.keys()].some((a) => a === path.posix.normalize(path.posix.join(path.posix.dirname(rel), decodePath(url)))))) {
          const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), decodePath(url)))
          if (!IMAGE_EXTENSIONS.has(path.extname(target).toLowerCase())) fail("unsupported-asset-type")
          const real = resolveSource(root, target)
          if (node.type === "image" && rel.startsWith("02-Literature/ZoteroNotes/")) verifyFigure(root, real, node.alt)
          assets.set(target, real)
        } else {
          const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), decodePath(url).split("#")[0]))
          const approved = notes.has(target) || notes.has(target + ".md")
          if (!approved) fail("unapproved-markdown-link")
        }
      }
      if (node.type === "text" && /!?\[\[/.test(node.value ?? "")) {
        const start = node.position.start.offset
        const fragment = md.slice(start, node.position.end.offset)
        const replaced = fragment.replace(/(!?)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, embed, raw, alias) => {
          if (embed) fail("wiki-embed-requires-review")
          const [target, anchor] = raw.split("#", 2)
          const resolved = notes.has(target + ".md") ? target + ".md" : titleMap.get(target)
          // Unapproved links are removed with their labels, never leaked as text.
          if (!resolved) fail("unapproved-wiki-link")
          const relative = path.posix.relative(path.posix.dirname(rel), resolved)
          return `[${alias ?? path.posix.basename(target)}](<${relative}${anchor ? "#" + anchor : ""}>)`
        })
        if (fragment !== replaced) replacements.push([start, node.position.end.offset, replaced])
      }
    })
    for (const [start, end, replacement] of replacements.sort((a, b) => b[0] - a[0])) md = md.slice(0, start) + replacement + md.slice(end)
    for (const f of ["url", "code_url", "project_url"].filter((f) => clean[f])) checkUrl(clean[f], cfg)
    const result = "---\n" + YAML.stringify(clean) + "---\n\n" + md.trim() + "\n"
    checkText(result, cfg)
    pending.set(rel, Buffer.from(result))
  }
  // All validation precedes output creation. Metadata is stripped by reencoding.
  for (const [rel, real] of assets) {
    let bytes
    try { bytes = await sharp(real, { animated: true }).toBuffer() } catch { fail("asset-decode-failed") }
    pending.set(rel, bytes)
  }
  if (overlay) {
    for (const rel of await globby("**/*.md", { cwd: overlay })) {
      if (!["index.md", "02-Literature/index.md"].includes(rel)) fail("unapproved-overlay")
      const { fm, body } = splitNote(fs.readFileSync(resolveSource(fs.realpathSync(overlay), rel), "utf8"))
      const result = "---\n" + YAML.stringify(publicFm(fm)) + "---\n\n" + body
      checkText(result, cfg)
      pending.set(rel, Buffer.from(result))
    }
  }
  for (const [rel] of pending) checkText(rel, cfg)
  const allowedSlugs = new Set()
  for (const [rel, bytes] of pending) {
    if (!rel.endsWith(".md")) continue
    const slug = slugify(rel)
    allowedSlugs.add(slug)
    // Quartz emits a mixed-case redirect page at the source path (only spaces
    // become dashes; Windows-reserved characters are kept), e.g. for a note
    // titled "AMP: ...". Accept those redirect paths as known pages too.
    allowedSlugs.add(rel.replace(/\.md$/i, "").split("/")
      .map((seg) => seg.replace(/\s/g, "-").toLowerCase()).join("/"))
    const parts = slug.split("/")
    for (let n = 1; n < parts.length; n++) allowedSlugs.add(parts.slice(0, n).join("/") + "/index")
    for (const tag of splitNote(bytes.toString()).fm.tags ?? []) {
      const segs = tag.split("/")
      for (let n = 1; n <= segs.length; n++) allowedSlugs.add("tags/" + segs.slice(0, n).join("/"))
    }
  }
  allowedSlugs.add("tags/index")
  fs.mkdirSync(dest, { recursive: true })
  for (const [rel, bytes] of pending) {
    const file = path.join(dest, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, bytes)
  }
  const manifest = { publication_schema: 2, allowedSlugs: [...allowedSlugs], sourceLinks, notes: [...notes.keys()].map(slugify),
    files: [...pending].map(([file, bytes]) => ({ file, sha256: sha(bytes) })) }
  fs.writeFileSync(path.join(dest, ".publication-manifest.json"), JSON.stringify(manifest))
  if (quartzConfig) {
    const site = YAML.parse(fs.readFileSync("quartz.config.yaml", "utf8"))
    site.configuration.pageTitle = cfg.garden?.title ?? "Research Notes"
    if (cfg.garden?.base_url) {
      checkUrl(cfg.garden.base_url, { privacy: {} })
      site.configuration.baseUrl = cfg.garden.base_url.replace(/^https?:\/\//, "").replace(/\/$/, "")
    }
    fs.writeFileSync(quartzConfig, YAML.stringify(site))
  }
  return { notes: notes.size, assets: assets.size, droppedLinks }
}

export async function auditArtifact({ config, content, output }) {
  const cfg = readConfig(config)
  assertNoSymlinks(content)
  assertNoSymlinks(output)
  const manifest = JSON.parse(fs.readFileSync(path.join(content, ".publication-manifest.json"), "utf8"))
  for (const { file, sha256 } of manifest.files) {
    const real = resolveSource(fs.realpathSync(content), file)
    if (sha(fs.readFileSync(real)) !== sha256) fail("staged-file-changed")
  }
  const staged = await globby("**/*", { cwd: content, dot: true, followSymbolicLinks: false })
  const expected = new Set([...manifest.files.map((f) => f.file), ".publication-manifest.json"])
  if (staged.some((f) => !expected.has(f))) fail("unexpected-staged-file")
  const files = await globby("**/*", { cwd: output, dot: true, followSymbolicLinks: false })
  const assets = new Set(manifest.files.filter((f) => !f.file.endsWith(".md")).map((f) => slugify(f.file)))
  const actual = new Set(files.map((f) => f.toLowerCase()))
  for (const asset of assets) if (!actual.has(asset)) fail("approved-asset-missing")
  for (const slug of manifest.notes) if (!actual.has(slug + ".html")) fail("approved-page-missing")
  for (const { slug, urls } of manifest.sourceLinks ?? []) {
    const rel = files.includes(slug + ".html") ? slug + ".html" : files.find((f) => f.toLowerCase() === slug + ".html")
    const html = fs.readFileSync(path.join(output, rel), "utf8")
    const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] ?? ""
    const headEnd = article.search(/<h[1-6]\b/i)
    const following = article.slice(headEnd + 1).search(/<h[1-6]\b/i)
    const opening = following >= 0 ? article.slice(0, headEnd + 1 + following) : article
    const hrefs = [...opening.matchAll(/href=["']([^"']*)["']/gi)].map((m) => decoded(m[1]))
    if (urls.some((u) => !hrefs.includes(decoded(u)))) fail("rendered-source-link-missing")
  }
  const index = JSON.parse(fs.readFileSync(path.join(output, "static/contentIndex.json"), "utf8"))
  const allowedSlugs = new Set(manifest.allowedSlugs)
  for (const [slug, entry] of Object.entries(index)) {
    if (!allowedSlugs.has(slug)) fail("unexpected-index-page")
    for (const link of entry.links ?? []) {
      if (!allowedSlugs.has(link) && !allowedSlugs.has(link + "/index")) fail("unexpected-index-link")
    }
  }
  for (const rel of files) {
    checkText(rel, cfg)
    const lower = rel.toLowerCase()
    if (rel.split("/").some((p) => p.startsWith(".")) && rel !== ".nojekyll") fail("hidden-artifact-file")
    if (/figure-(?:ledger|candidates)\.json$/i.test(rel)) fail("private-ledger-in-artifact")
    if (lower.endsWith(".json") && !["static/contentindex.json", "static/encryptedcontentindex.json"].includes(lower)) fail("unexpected-artifact-json")
    if (lower === "static/encryptedcontentindex.json") {
      const encrypted = JSON.parse(fs.readFileSync(path.join(output, rel), "utf8"))
      if (!Array.isArray(encrypted.entries) || encrypted.entries.length) fail("encrypted-content-in-public-artifact")
    }
    if (lower.endsWith(".html") && lower !== "404.html" && !allowedSlugs.has(lower.slice(0, -5))) fail("unexpected-artifact-page")
    if (!/\.(?:html|json|xml|txt|js|css|map|png|jpe?g|webp|gif|ico|woff2?|ttf|otf|webmanifest)$/i.test(rel) && rel !== ".nojekyll") fail("unexpected-artifact-type")
    const file = path.join(output, rel)
    if (fs.lstatSync(file).isSymbolicLink()) fail("artifact-symlink")
    if (/\.(?:md|pdf|sqlite|db|ya?ml|env|pem|key)$/i.test(rel)) fail("unexpected-artifact-type")
    if (lower.startsWith("02-literature/") && IMAGE_EXTENSIONS.has(path.extname(lower)) && !assets.has(lower)) fail("unapproved-artifact-asset")
    if (assets.has(lower)) {
      const sourceFile = manifest.files.find((f) => slugify(f.file) === lower)
      if (sha(fs.readFileSync(file)) !== sourceFile.sha256) fail("rendered-asset-changed")
    }
    if (/\.(?:html|json|xml|txt|js|css|map)$/i.test(rel)) {
      const text = fs.readFileSync(file, "utf8")
      checkText(text, cfg)
      if (/\.(?:html|xml)$/i.test(rel)) {
        for (const m of text.matchAll(/(?:href|src)=["']([^"']*)["']/gi)) {
          if (/^(?:https?:)?\/\//i.test(m[1])) checkUrl(m[1].startsWith("//") ? "https:" + m[1] : m[1], cfg)
          else if (/^[a-z][a-z0-9+.-]*:/i.test(decoded(m[1]))) fail("unexpected-artifact-uri")
        }
      }
    }
  }
  return { files: files.length, notes: manifest.notes.length }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [command, ...args] = process.argv.slice(2)
  const opts = {}
  for (let i = 0; i < args.length; i += 2) opts[args[i].replace(/^--/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = args[i + 1]
  try {
    const result = command === "export" ? await exportContent(opts) : command === "audit" ? await auditArtifact(opts) : fail("unknown-command")
    console.log(JSON.stringify({ ok: true, ...result }))
  } catch (error) {
    // Only our rule identifiers are safe for public logs.
    console.error(JSON.stringify({ ok: false, rule: /^[a-z-]+$/.test(error.message) ? error.message : "publication-failed" }))
    process.exitCode = 1
  }
}
