import { h } from "preact"
import type {
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
  QuartzPageTypePlugin,
  StringResource,
  VirtualPage,
} from "@quartz-community/types"
import { resolveRelative } from "@quartz-community/utils/path"
import { htmlToJsx } from "@quartz-community/utils/jsx"
import type { Node, Element } from "hast"

// ---------------------------------------------------------------------------
// Literature index — build-time replacement for the vault's Dataview tables,
// which Quartz does not execute. Public grouping is by year; reading-status
// tags (status/deep-read etc.) are private and stripped from the public build.
// ---------------------------------------------------------------------------

type Fm = Record<string, any>

interface Entry {
  slug: string
  title: string
  authors: string | null
  year: number | null
  venue: string | null
  topics: string[]
  date: Date | null
}

const PREFIX = "02-literature"

function toNum(v: unknown): number | null {
  const n = typeof v === "string" ? parseInt(v, 10) : typeof v === "number" ? v : NaN
  return Number.isFinite(n) ? n : null
}

function toDate(v: unknown): Date | null {
  if (!v) return null
  const d = new Date(v as string)
  return Number.isNaN(d.getTime()) ? null : d
}

function makeEntry(slug: string, fm: Fm): Entry {
  return {
    slug,
    title: (fm.title as string) ?? slug,
    authors: Array.isArray(fm.authors) ? (fm.authors as string[]).join(", ") : null,
    year: toNum(fm.year),
    venue: typeof fm.venue === "string" && fm.venue ? fm.venue : null,
    topics: ((fm.tags as string[]) ?? [])
      .filter((t) => t.startsWith("topic/") || t.startsWith("method/"))
      .slice(0, 4),
    date: toDate(fm.date ?? fm.created),
  }
}

function sortEntries(a: Entry, b: Entry): number {
  const da = a.date?.getTime() ?? 0
  const db = b.date?.getTime() ?? 0
  if (da !== db) return db - da
  return a.title.localeCompare(b.title)
}

function collectEntries(allFiles: { slug?: string; frontmatter?: Fm }[]): Entry[] {
  const entries: Entry[] = []
  for (const data of allFiles) {
    const slug = data.slug
    if (!slug || !slug.startsWith(`${PREFIX}/`)) continue
    if (slug.endsWith("/index") || slug === `${PREFIX}/02-literature-moc`) continue
    entries.push(makeEntry(slug, data.frontmatter ?? {}))
  }
  entries.sort(sortEntries)
  return entries
}

function groupByYear(entries: Entry[]): { label: string; items: Entry[] }[] {
  const byYear = new Map<string, Entry[]>()
  for (const e of entries) {
    const key = e.year ? String(e.year) : e.date ? String(e.date.getFullYear()) : "其他"
    const list = byYear.get(key) ?? []
    list.push(e)
    byYear.set(key, list)
  }
  return [...byYear.entries()]
    .sort((a, b) => {
      if (a[0] === "其他") return 1
      if (b[0] === "其他") return -1
      return b[0].localeCompare(a[0])
    })
    .map(([label, items]) => ({ label, items }))
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function renderIndexSection(slug: string, groups: { label: string; items: Entry[] }[]) {
  return h(
    "div",
    { class: "lit-index" },
    groups.map((g) =>
      h(
        "section",
        { class: "lit-group" },
        h("h2", {}, g.label, h("span", { class: "lit-count" }, String(g.items.length))),
        h(
          "ul",
          { class: "lit-list" },
          g.items.map((e) =>
            h(
              "li",
              { class: "lit-item" },
              h(
                "div",
                { class: "lit-card" },
                h(
                  "h3",
                  { class: "lit-card-title" },
                  h(
                    "a",
                    {
                      href: resolveRelative(slug, e.slug),
                      class: "internal internal-link",
                    },
                    e.title,
                  ),
                ),
                h(
                  "div",
                  { class: "lit-card-meta" },
                  e.authors && h("span", { class: "lit-authors" }, e.authors),
                  h(
                    "span",
                    { class: "lit-pub" },
                    e.venue && h("span", { class: "lit-venue" }, e.venue),
                    e.year && h("span", { class: "lit-year" }, String(e.year)),
                  ),
                ),
                e.topics.length > 0 &&
                  h(
                    "div",
                    { class: "lit-card-tags" },
                    e.topics.map((t) =>
                      h(
                        "a",
                        { class: "lit-tag", href: resolveRelative(slug, `tags/${t}`) },
                        t.split("/")[1] ?? t,
                      ),
                    ),
                  ),
              ),
            ),
          ),
        ),
      ),
    ),
  )
}

/** Strip dataview code blocks (Quartz does not execute them) from a hast tree. */
function stripDataview(root: Node): void {
  const element = root as Element
  if (!element.children) return
  const isDataviewCode = (node: unknown): boolean => {
    const el = node as Element
    if (!el || el.type !== "element") return false
    // syntax-highlighted form: figure/pre/code with data-language="dataview"
    if (el.properties?.dataLanguage === "dataview") return true
    if (Array.isArray(el.properties?.className)) {
      if ((el.properties.className as string[]).some((c) => String(c).includes("dataview")))
        return true
    }
    return false
  }
  const stripFrom = (parent: Element): void => {
    if (!parent.children) return
    parent.children = parent.children.filter((child) => {
      if (child.type !== "element") return true
      const el = child as Element
      // plain fenced form: pre > code.language-dataview
      if (isDataviewCode(el)) return false
      // highlighted form: figure wrapping a dataview pre/code
      if (el.tagName === "figure" && el.children?.some(isDataviewCode)) return false
      return true
    })
    for (const child of parent.children) {
      if (child.type === "element") stripFrom(child as Element)
    }
  }
  stripFrom(element)
}

/** Remove headings whose entire section (up to the next heading of same/higher
 *  level) consisted only of stripped dataview blocks. Called after stripDataview. */
function pruneEmptyDataviewSections(root: Node): void {
  const element = root as Element
  if (!element.children) return
  const headingLevel = (el: Element): number | null => {
    const m = /^h([1-6])$/.exec(el.tagName)
    return m ? parseInt(m[1], 10) : null
  }
  const hasText = (el: Element): boolean => {
    if (el.type === "text") return Boolean((el as any).value?.trim())
    if (el.type === "element") {
      // anchors/toc links injected by headings don't count as content
      if (el.tagName === "a" && el.properties?.dataNoPopover === "true") return false
      return (el.children ?? []).some((c) => hasText(c as Element))
    }
    return false
  }
  const isPrunable = (title: string): boolean => isPrivateHeading(title)

  let removed = true
  while (removed) {
    removed = false
    const children = [...element.children]
    for (let i = 0; i < children.length; i++) {
      const node = children[i]
      if (node.type !== "element") continue
      const el = node as Element
      const level = headingLevel(el)
      if (!level) continue
      if (!isPrunable(textOf(el))) continue
      // find end of section: next heading with level <= this one
      let end = children.length
      for (let j = i + 1; j < children.length; j++) {
        if (children[j].type !== "element") continue
        const l = headingLevel(children[j] as Element)
        if (l && l <= level) {
          end = j
          break
        }
      }
      element.children.splice(i, end - i)
      removed = true
      break
    }
  }
  for (const child of element.children) {
    if (child.type === "element") pruneEmptyDataviewSections(child as Element)
  }
}

/** Headings whose sections are pruned from public pages (also used to sync TOC). */
const PRIVATE_HEADING_RE = /明日|精读建议|阅读计划|阅读顺序|Dataview 自动|最近新增文献|活跃文献笔记/

function isPrivateHeading(text: string): boolean {
  return PRIVATE_HEADING_RE.test(text)
}

function textOf(el: Element): string {
  let out = ""
  for (const c of el.children ?? []) {
    if (c.type === "text") out += (c as any).value ?? ""
    else if (c.type === "element") out += textOf(c as Element)
  }
  return out
}

/** Remove private/reading-plan info from public pages:
 *  - inline links to status/* tag pages and the reading-log note
 *  - "精读状态" / "阅读管理" list items and paragraphs
 *  Called after stripDataview. */
function stripPrivateSections(root: Node): void {
  const stripFrom = (parent: Element): void => {
    if (!parent.children) return
    parent.children = parent.children.filter((child) => {
      if (child.type !== "element") return true
      const el = child as Element

      // links to private tag pages / reading log
      if (el.tagName === "a") {
        const href = String(el.properties?.href ?? "")
        if (href.includes("/tags/status/") || href.includes("论文阅读记录")) return false
        return true
      }

      // paragraphs / list items whose text is about reading status/plan
      if (el.tagName === "p" || el.tagName === "li") {
        const text = textOf(el)
        if (text.includes("精读状态") || text.includes("阅读管理")) return false
        // list item that only linked to the removed reading log
        if (
          el.tagName === "li" &&
          el.children?.every((c) => c.type !== "text" || !((c as any).value ?? "").trim())
        ) {
          const links = el.children?.filter((c) => (c as Element).type === "element") ?? []
          if (links.length > 0 && links.every((c) => (c as Element).tagName === "a")) return false
        }
      }
      return true
    })
    for (const child of parent.children) {
      if (child.type === "element") stripPrivateSections(child as Element)
    }
  }
  stripFrom(root as Element)
}

// ---------------------------------------------------------------------------
// Body component
// ---------------------------------------------------------------------------

const renderBody = (props: QuartzComponentProps) => {
  const slug = props.fileData.slug!
  const fm = (props.fileData.frontmatter ?? {}) as Fm

  // TOC entries are extracted at markdown phase, before dataview pruning —
  // drop the pruned headings here so the sidebar TOC matches the page.
  const toc = props.fileData.toc as { text: string }[] | undefined
  if (Array.isArray(toc)) {
    props.fileData.toc = toc.filter((t) => !isPrivateHeading(t.text))
  }

  // Original markdown content (dataview blocks + their now-empty sections stripped)
  stripDataview(props.tree)
  pruneEmptyDataviewSections(props.tree)
  stripPrivateSections(props.tree)
  const original = htmlToJsx(props.tree)

  if (slug !== `${PREFIX}/index`) {
    // MOC keeps its hand-written content; index page is fully generated
    return h("div", { class: "lit-page" }, original)
  }

  const entries = collectEntries(props.allFiles as any)
  const groups = groupByYear(entries)

  return h(
    "div",
    { class: "lit-page" },
    original,
    h("div", { class: "lit-summary" }, `共 ${entries.length} 篇文献 · 构建时自动生成`),
    renderIndexSection(slug, groups),
  )
}

const LiteratureBody = (() => {
  const Body: QuartzComponent = (props: QuartzComponentProps) => renderBody(props)
  ;(Body as any).css = css as StringResource
  return Body
}) as unknown as QuartzComponentConstructor

// Styles injected via component css (collected by the ComponentResources emitter)
const css = `
/* ---- year group headers ---- */
.lit-index { margin-top: 0.5rem; }
.lit-index .lit-group { margin-block: 2.2rem 2.6rem; }
.lit-index .lit-group h2 {
  display: flex; align-items: baseline; gap: 0.6rem;
  margin-block: 0 1.1rem; padding-bottom: 0.5rem;
  border-bottom: 2px solid var(--lightgray);
}
.lit-index .lit-count {
  font-size: 0.68em; font-weight: 500; color: var(--gray);
  background: var(--lightgray); border-radius: 999px;
  padding: 0.05rem 0.65rem; line-height: 1.7;
}

/* ---- paper cards ---- */
.lit-index .lit-list {
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: 0.85rem;
}
.lit-index .lit-item { list-style: none; }
.lit-index .lit-card {
  border: 1px solid var(--lightgray);
  border-left: 3px solid var(--lightgray);
  border-radius: 8px;
  padding: 0.85rem 1.1rem 0.9rem;
  background: var(--light);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.lit-index .lit-card:hover {
  border-left-color: var(--secondary);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06);
}
.lit-index .lit-card-title {
  margin: 0 0 0.4rem;
  font-size: 1.02rem; font-weight: 600; line-height: 1.4;
}
.lit-index .lit-card-title a { color: var(--dark); }
.lit-index .lit-card-title a:hover { color: var(--secondary); }

/* meta row: authors · venue year */
.lit-index .lit-card-meta {
  display: flex; flex-wrap: wrap; align-items: baseline;
  gap: 0.25rem 0.9rem;
  font-size: 0.8rem; color: var(--gray);
  margin-bottom: 0.45rem;
}
.lit-index .lit-authors {
  min-width: 0; max-width: 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.lit-index .lit-pub {
  display: inline-flex; align-items: baseline; gap: 0.4rem;
  white-space: nowrap;
}
.lit-index .lit-venue {
  font-style: italic; color: var(--darkgray);
  background: var(--lightgray);
  border-radius: 4px; padding: 0 0.4rem;
  font-size: 0.92em;
}
.lit-index .lit-year { font-variant-numeric: tabular-nums; }

/* topic tag pills */
.lit-index .lit-card-tags {
  display: flex; flex-wrap: wrap; gap: 0.35rem;
}
.lit-index .lit-tag {
  font-size: 0.7rem; line-height: 1.5;
  border: none; border-radius: 999px;
  padding: 0.08rem 0.6rem;
  color: var(--darkgray);
  background: color-mix(in srgb, var(--secondary) 8%, transparent);
}
.lit-index .lit-tag::before { content: ""; }
.lit-index .lit-tag:hover {
  color: var(--secondary);
  background: color-mix(in srgb, var(--secondary) 16%, transparent);
}

/* summary footer */
.lit-summary {
  margin-top: 2.5rem; padding-top: 1rem;
  border-top: 1px solid var(--lightgray);
  font-size: 0.85rem; color: var(--gray);
}

/* dark mode adjustments */
:root[saved-theme="dark"] .lit-index .lit-card,
:root.dark .lit-index .lit-card {
  box-shadow: none;
}
:root[saved-theme="dark"] .lit-index .lit-card:hover,
:root.dark .lit-index .lit-card:hover {
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.4);
}
`.trim()

// ---------------------------------------------------------------------------
// Page type plugin — takes over the literature navigation pages
// ---------------------------------------------------------------------------

const LIT_SLUGS = new Set([`${PREFIX}/index`, `${PREFIX}/02-literature-moc`])

const LiteratureIndexPage: QuartzPageTypePlugin = () => ({
  name: "LiteratureIndexPage",
  priority: 15,
  match: ({ slug }) => LIT_SLUGS.has(slug),
  layout: "content",
  body: LiteratureBody,
  treeTransforms: () => [
    // public pages: drop reading-status tag links everywhere
    (root, slug, componentData) => {
      stripPrivateSections(root)
      // keep private status/* tags out of rendered tag lists / properties view
      const fm = componentData?.fileData?.frontmatter as Fm | undefined
      if (fm && Array.isArray(fm.tags)) {
        fm.tags = (fm.tags as string[]).filter((t) => !t.startsWith("status/"))
      }
      // TOC entries reference content pruned below — sync them
      const toc = componentData?.fileData?.toc as { text: string }[] | undefined
      if (Array.isArray(toc)) {
        componentData.fileData.toc = toc.filter((t) => !isPrivateHeading(t.text))
      }
    },
    (root, slug) => {
      if (!LIT_SLUGS.has(slug)) return
      stripDataview(root)
      pruneEmptyDataviewSections(root)
    },
  ],
})

export default LiteratureIndexPage
