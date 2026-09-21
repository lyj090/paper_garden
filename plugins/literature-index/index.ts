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
// which Quartz does not execute. Public grouping is by research area
// (frontmatter area/* tags); private namespaces are stripped from the build.
// ---------------------------------------------------------------------------

type Fm = Record<string, any>

interface Entry {
  slug: string
  title: string
  authors: string | null
  year: number | null
  venue: string | null
  topics: string[]
  kind: string | null
  areas: string[]
  date: Date | null
  /** paper = ZoteroNotes (formal papers), clip = WebNotes (web excerpts) */
  source: "paper" | "clip"
  /** all public tag slugs, for client-side tag filtering */
  allTags: string[]
}

const PREFIX = "02-literature"

/** area slug -> display label (frontmatter uses area/<slug>) */
const AREA_LABELS: Record<string, string> = {
  robotics: "机器人学",
  "machine-learning": "机器学习",
  "computer-vision": "计算机视觉",
  control: "控制",
  "control-theory": "控制理论",
  tools: "工具与系统",
}

const AREA_ORDER = [
  "robotics",
  "machine-learning",
  "computer-vision",
  "control",
  "control-theory",
  "tools",
]

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
  const tags: string[] = fm.tags ?? []
  const kindTag = tags.find((t) => t.startsWith("type/") && t !== "type/paper")
  return {
    slug,
    title: (fm.title as string) ?? slug,
    authors: Array.isArray(fm.authors) ? (fm.authors as string[]).join(", ") : null,
    year: toNum(fm.year),
    venue: typeof fm.venue === "string" && fm.venue ? fm.venue : null,
    topics: tags.filter((t) => t.startsWith("topic/") || t.startsWith("method/")).slice(0, 3),
    kind: kindTag ? kindTag.split("/")[1] : null,
    areas: tags.filter((t) => t.startsWith("area/")).map((t) => t.slice("area/".length)),
    date: toDate(fm.date ?? fm.created),
    source: slug.includes("/zoteronotes/") ? "paper" : "clip",
    /** all public tag slugs, used for client-side tag filtering */
    allTags: tags
      .filter(
        (t) =>
          t.startsWith("topic/") ||
          t.startsWith("method/") ||
          t.startsWith("area/") ||
          t.startsWith("task/") ||
          t.startsWith("hardware/"),
      )
      .map((t) => t),
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

interface Group {
  label: string
  anchor: string
  items: Entry[]
}

interface TopicNav {
  slug: string
  label: string
  count: number
}

/** Most-used topic/method tags for the side-nav "常用主题" section. */
function buildTopicNav(entries: Entry[], max = 8): TopicNav[] {
  const counts = new Map<string, number>()
  for (const e of entries) {
    for (const t of e.topics) {
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([slug, count]) => ({ slug, label: slug.split("/")[1] ?? slug, count }))
}

function groupByArea(entries: Entry[]): Group[] {
  const byArea = new Map<string, Entry[]>()
  for (const e of entries) {
    // a paper can span multiple areas — list it under each (dedup by title)
    const areas = e.areas.length > 0 ? e.areas : ["其他"]
    for (const a of areas) {
      const list = byArea.get(a) ?? []
      if (!list.some((x) => x.slug === e.slug)) list.push(e)
      byArea.set(a, list)
    }
  }
  const groups: Group[] = []
  for (const area of AREA_ORDER) {
    const items = byArea.get(area)
    if (items && items.length > 0) {
      groups.push({ label: AREA_LABELS[area] ?? area, anchor: area, items })
    }
  }
  for (const [area, items] of byArea) {
    if (!AREA_ORDER.includes(area) && area !== "其他") {
      groups.push({ label: AREA_LABELS[area] ?? area, anchor: area, items })
    }
  }
  const other = byArea.get("其他")
  if (other && other.length > 0) {
    groups.push({ label: "其他", anchor: "other", items: other })
  }
  return groups
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/** Toolbar for client-side sort / filter of the paper cards. Sort keys are
 *  embedded as data-* attributes on each card at build time. */
const toolbarScript = `
(function () {
  var index = document.querySelector(".lit-index")
  if (!index) return
  var cards = Array.prototype.slice.call(index.querySelectorAll(".lit-item"))
  if (cards.length === 0) return
  var flat = index.querySelector(".lit-flat")
  var list = index.querySelector(".lit-list")
  if (!flat || !list) return

  // move every card into one flat list; group headers are rebuilt on sort
  var groups = Array.prototype.slice.call(index.querySelectorAll(".lit-group"))
  var groupOf = new Map()
  groups.forEach(function (g) {
    var key = g.id
    g.querySelectorAll(".lit-item").forEach(function (item) {
      groupOf.set(item, key)
      item.remove()
    })
  })

  var state = { sort: "added-desc", source: "all", query: "", tagList: [] }

  // tag pages: start with the page's own tag pre-applied (build-time context)
  var tagCtx = document.querySelector(".lit-tag-context")
  if (tagCtx) {
    var ownTag = tagCtx.getAttribute("data-tag") || ""
    if (ownTag) state.tagList.push(ownTag)
  }
  var chipBar = index.querySelector(".lit-chipbar")

  function fmtDate(ts) {
    var d = new Date(ts)
    return d.toLocaleDateString("zh-CN", { year: "numeric", month: "short" })
  }

  function apply() {
    renderTagChips()
    if (chipBar) {
      if (state.tagList.length > 0) chipBar.classList.add("lit-has-chips")
      else chipBar.classList.remove("lit-has-chips")
    }
    // highlight tag pills that are part of the active filter
    cards.forEach(function (item) {
      var pill = item.querySelector(".lit-tag")
      item.querySelectorAll("a.lit-tag").forEach(function (p) {
        var t = (p.getAttribute("data-tag") || "").toLowerCase()
        if (state.tagList.map(function (x) { return x.toLowerCase() }).indexOf(t) >= 0) {
          p.classList.add("lit-tag-active")
        } else {
          p.classList.remove("lit-tag-active")
        }
      })
    })
    // filter
    var visible = cards.filter(function (item) {
      var card = item.querySelector(".lit-card")
      var src = card.getAttribute("data-source")
      if (state.source === "paper" && src !== "paper") return false
      if (state.source === "clip" && src !== "clip") return false
      if (state.tagList.length > 0) {
        var tags = (card.getAttribute("data-tags") || "").toLowerCase().split("|")
        for (var i = 0; i < state.tagList.length; i++) {
          if (tags.indexOf(state.tagList[i].toLowerCase()) === -1) return false
        }
      }
      if (state.query) {
        var hay = (card.getAttribute("data-search") || "").toLowerCase()
        if (hay.indexOf(state.query) === -1) return false
      }
      return true
    })

    // sort
    var cmp = {
      "added-desc": function (a, b) {
        return (b.querySelector(".lit-card").getAttribute("data-added") || 0) -
               (a.querySelector(".lit-card").getAttribute("data-added") || 0)
      },
      "added-asc": function (a, b) {
        return (a.querySelector(".lit-card").getAttribute("data-added") || 0) -
               (b.querySelector(".lit-card").getAttribute("data-added") || 0)
      },
      "year-desc": function (a, b) {
        return (b.querySelector(".lit-card").getAttribute("data-year") || 0) -
               (a.querySelector(".lit-card").getAttribute("data-year") || 0) ||
               a.querySelector(".lit-card").getAttribute("data-title").localeCompare(
                 b.querySelector(".lit-card").getAttribute("data-title"))
      },
      "year-asc": function (a, b) {
        return (a.querySelector(".lit-card").getAttribute("data-year") || 0) -
               (b.querySelector(".lit-card").getAttribute("data-year") || 0) ||
               a.querySelector(".lit-card").getAttribute("data-title").localeCompare(
                 b.querySelector(".lit-card").getAttribute("data-title"))
      },
      "title-asc": function (a, b) {
        return a.querySelector(".lit-card").getAttribute("data-title").localeCompare(
          b.querySelector(".lit-card").getAttribute("data-title"))
      },
      "title-desc": function (a, b) {
        return b.querySelector(".lit-card").getAttribute("data-title").localeCompare(
          a.querySelector(".lit-card").getAttribute("data-title"))
      },
    }[state.sort]

    visible.sort(cmp)

    if (state.sort === "added-desc" && state.source === "all" && !state.query && state.tagList.length === 0) {
      // default view: restore build-time area grouping
      var byGroup = new Map()
      visible.forEach(function (item) {
        var key = groupOf.get(item) || "other"
        if (!byGroup.has(key)) byGroup.set(key, [])
        byGroup.get(key).push(item)
      })
      groups.forEach(function (g) {
        var ul = g.querySelector(".lit-list")
        ;(byGroup.get(g.id) || []).forEach(function (item) { ul.appendChild(item) })
        g.style.display = (byGroup.get(g.id) || []).length > 0 ? "" : "none"
      })
      flat.classList.add("lit-hidden")
    } else {
      // flat ranked list with a date/year caption per card
      groups.forEach(function (g) { g.style.display = "none" })
      flat.classList.remove("lit-hidden")
      visible.forEach(function (item) {
        var card = item.querySelector(".lit-card")
        var meta = card.querySelector(".lit-card-meta")
        var stamp = meta.querySelector(".lit-added")
        var added = parseInt(card.getAttribute("data-added") || "0", 10)
        if (!isNaN(added) && added > 0) {
          if (!stamp) {
            stamp = document.createElement("span")
            stamp.className = "lit-added"
            meta.appendChild(stamp)
          }
          stamp.textContent = "入库 " + fmtDate(added)
        }
        flat.appendChild(item)
      })
    }

    // per-group counts + toolbar result count
    var count = index.querySelector(".lit-result-count")
    if (count) count.textContent = String(visible.length)
  }

  index.addEventListener("change", function (e) {
    var t = e.target
    if (t.matches("[data-sort-select]")) {
      state.sort = t.value
      apply()
    } else if (t.matches("[data-source-select]")) {
      state.source = t.value
      apply()
    }
  })
  index.addEventListener("input", function (e) {
    if (e.target.matches("[data-search-input]")) {
      state.query = e.target.value.trim().toLowerCase()
      apply()
    }
  })

  // stacked tag filtering: clicking a tag pill toggles it in state.tagList
  index.addEventListener("click", function (e) {
    var t = e.target
    // tag pill on a card
    var pill = t.closest ? t.closest("[data-tag]") : null
    if (pill && pill.classList && pill.classList.contains("lit-tag")) {
      e.preventDefault()
      toggleTag(pill.getAttribute("data-tag"))
      return
    }
    // remove-button on an active tag chip
    if (t.matches && t.matches("[data-tag-remove]")) {
      e.preventDefault()
      toggleTag(t.getAttribute("data-tag-remove"))
    }
  })

  function toggleTag(tag) {
    if (!tag) return
    var i = state.tagList.indexOf(tag)
    if (i >= 0) state.tagList.splice(i, 1)
    else state.tagList.push(tag)
    apply()
  }

  function renderTagChips() {
    if (!chipBar) return
    chipBar.innerHTML = ""
    state.tagList.forEach(function (tag) {
      var chip = document.createElement("span")
      chip.className = "lit-chip"
      chip.textContent = tag + " "
      var x = document.createElement("button")
      x.className = "lit-chip-x"
      x.setAttribute("data-tag-remove", tag)
      x.setAttribute("aria-label", "移除筛选 " + tag)
      x.textContent = "×"
      chip.appendChild(x)
      chipBar.appendChild(chip)
    })
  }

  apply()
})();
`

function renderToolbar(): ReturnType<typeof h> {
  const select = (attr: string, options: [string, string][]): ReturnType<typeof h> =>
    h(
      "select",
      { class: "lit-toolbar-select", [attr]: "" },
      options.map(([value, label]) => h("option", { value }, label)),
    )

  return h(
    "div",
    { class: "lit-toolbar-wrap" },
    h(
      "div",
      { class: "lit-toolbar" },
      h("input", {
        class: "lit-toolbar-search",
        type: "search",
        placeholder: "搜索标题 / 作者 / 标签…",
        "data-search-input": "",
        "aria-label": "搜索文献",
      }),
      h(
        "label",
        { class: "lit-toolbar-field" },
        h("span", { class: "lit-toolbar-label" }, "类型"),
        select("data-source-select", [
          ["all", "全部"],
          ["paper", "论文"],
          ["clip", "网页摘录"],
        ]),
      ),
      h(
        "label",
        { class: "lit-toolbar-field" },
        h("span", { class: "lit-toolbar-label" }, "排序"),
        select("data-sort-select", [
          ["added-desc", "入库时间 新→旧"],
          ["added-asc", "入库时间 旧→新"],
          ["year-desc", "论文年份 新→旧"],
          ["year-asc", "论文年份 旧→新"],
          ["title-asc", "标题 A→Z"],
          ["title-desc", "标题 Z→A"],
        ]),
      ),
      h("span", { class: "lit-result" }, h("span", { class: "lit-result-count" }), " 篇"),
    ),
    h("div", { class: "lit-chipbar" }),
  )
}

function renderIndexSection(slug: string, groups: Group[], topicNav: TopicNav[]) {
  return h(
    "div",
    { class: "lit-index" },
    // mobile horizontal scroller (desktop uses the left-sidebar nav component)
    h(
      "nav",
      { class: "lit-nav" },
      groups.map((g) =>
        h(
          "a",
          { href: `#${g.anchor}`, class: "lit-nav-link" },
          g.label,
          h("span", { class: "lit-nav-count" }, String(g.items.length)),
        ),
      ),
    ),
    renderToolbar(),
    h("ul", { class: "lit-flat lit-hidden" }),
    groups.map((g) =>
      h(
        "section",
        { class: "lit-group", id: g.anchor },
        h("h2", {}, g.label, h("span", { class: "lit-count" }, String(g.items.length))),
        h(
          "ul",
          { class: "lit-list" },
          g.items.map((e) => {
            const search = [e.title, e.authors, ...e.topics, e.venue, e.year]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
            return h(
              "li",
              { class: "lit-item" },
              h(
                "div",
                {
                  class: "lit-card",
                  "data-added": e.date ? String(e.date.getTime()) : "",
                  "data-year": e.year ? String(e.year) : "",
                  "data-title": e.title,
                  "data-source": e.source,
                  "data-search": search,
                  "data-tags": e.allTags.join("|"),
                },
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
                    e.kind && h("span", { class: "lit-kind" }, e.kind),
                    e.venue && h("span", { class: "lit-venue" }, e.venue),
                    e.year && h("span", { class: "lit-year" }, String(e.year)),
                  ),
                ),
                e.topics.length > 0 &&
                  h(
                    "div",
                    { class: "lit-card-tags" },
                    e.topics.map((t) => {
                      const ns = t.split("/")[0]
                      return h(
                        "a",
                        {
                          class: `lit-tag lit-tag-${ns}`,
                          href: resolveRelative(slug, `tags/${t}`),
                          // cross-namespace tag link: carries the tag for the
                          // toolbar to combine with the target page's own tag
                          "data-tag": t,
                        },
                        t.split("/")[1] ?? t,
                      )
                    }),
                  ),
              ),
            )
          }),
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

  if (slug !== `${PREFIX}/index` && !isLitTagSlug(slug)) {
    // MOC keeps its hand-written content; index page is fully generated
    return h("div", { class: "lit-page" }, original)
  }

  if (isLitTagSlug(slug)) {
    // Tag page: unified card list with the same toolbar as the index page.
    // The page's own tag is pre-applied as a client-side filter, and clicking
    // tag pills on cards ADDS more filters (stacked, AND semantics).
    const entries = collectEntries(props.allFiles as any)
    const groups = [{ label: "文献列表", anchor: "tag", items: entries }]
    return h(
      "div",
      { class: "lit-page lit-tag-page" },
      h("div", {
        class: "lit-tag-context",
        "data-tag": slug === "tags" ? "" : slug.split("/").slice(1).join("/"),
      }),
      renderIndexSection(slug, groups, []),
      h("div", { class: "lit-summary" }, `共 ${entries.length} 篇文献 · 构建时自动生成`),
    )
  }

  const entries = collectEntries(props.allFiles as any)
  const groups = groupByArea(entries)

  return h(
    "div",
    { class: "lit-page" },
    original,
    renderIndexSection(slug, groups, buildTopicNav(entries)),
    h("div", { class: "lit-summary" }, `共 ${entries.length} 篇文献 · 构建时自动生成`),
  )
}

const LiteratureBody = (() => {
  const Body: QuartzComponent = (props: QuartzComponentProps) => renderBody(props)
  ;(Body as any).css = css as StringResource
  ;(Body as any).afterDOMLoaded = toolbarScript as StringResource
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
.lit-index .lit-kind {
  text-transform: capitalize;
  color: var(--secondary);
  background: color-mix(in srgb, var(--secondary) 10%, transparent);
  border-radius: 4px; padding: 0 0.45rem;
  font-size: 0.92em; font-weight: 550;
}
.lit-index .lit-year { font-variant-numeric: tabular-nums; }

/* topic tag pills — colored by namespace for scannability */
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
/* method/* pills get a distinct warm tint */
.lit-index .lit-tag-method {
  background: color-mix(in srgb, #b8860b 10%, transparent);
  color: color-mix(in srgb, #b8860b 70%, var(--darkgray));
}
.lit-index .lit-tag-method:hover {
  background: color-mix(in srgb, #b8860b 18%, transparent);
  color: color-mix(in srgb, #b8860b 85%, var(--dark));
}
:root[saved-theme="dark"] .lit-index .lit-tag-method,
:root.dark .lit-index .lit-tag-method {
  background: color-mix(in srgb, #d4a72c 14%, transparent);
  color: color-mix(in srgb, #d4a72c 75%, var(--darkgray));
}

/* ---- toolbar: search / filter / sort (client-side over embedded data attrs) ---- */
.lit-toolbar {
  display: flex; flex-wrap: wrap; align-items: center;
  gap: 0.55rem;
  margin-block: 0.75rem 1.6rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--lightgray);
  border-radius: 10px;
  background: color-mix(in srgb, var(--lightgray) 30%, var(--light));
}
.lit-toolbar-search {
  flex: 1 1 11rem;
  min-width: 0;
  font: inherit; font-size: 0.85rem;
  color: var(--dark);
  background: var(--light);
  border: 1px solid var(--lightgray);
  border-radius: 8px;
  padding: 0.32rem 0.7rem;
  outline: none;
}
.lit-toolbar-search:focus {
  border-color: var(--gray);
}
.lit-toolbar-field {
  display: inline-flex; align-items: center; gap: 0.35rem;
}
.lit-toolbar-label {
  font-size: 0.75rem; color: var(--gray);
}
.lit-toolbar-select {
  font: inherit; font-size: 0.8rem;
  color: var(--darkgray);
  background: var(--light);
  border: 1px solid var(--lightgray);
  border-radius: 8px;
  padding: 0.28rem 0.5rem;
  cursor: pointer;
}
.lit-toolbar-select:hover { border-color: var(--gray); }
/* wrap toolbar + chip bar */
.lit-toolbar-wrap { margin-block: 0.75rem 1.6rem; }
.lit-toolbar-wrap .lit-toolbar { margin-block: 0; }

/* active tag filter chips */
.lit-chipbar {
  display: none;
  flex-wrap: wrap; align-items: center;
  gap: 0.4rem;
  margin-top: 0.5rem;
}
.lit-chipbar.lit-has-chips { display: flex; }
.lit-chip {
  display: inline-flex; align-items: center; gap: 0.3rem;
  font-size: 0.75rem;
  color: var(--secondary);
  background: color-mix(in srgb, var(--secondary) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--secondary) 30%, transparent);
  border-radius: 999px;
  padding: 0.14rem 0.4rem 0.14rem 0.65rem;
}
.lit-chip-x {
  font: inherit; font-size: 0.85rem; line-height: 1;
  border: none; background: none; cursor: pointer;
  color: var(--gray);
  padding: 0 0.15rem;
}
.lit-chip-x:hover { color: var(--dark); }

/* tag pills on cards: clickable toggle look + active state */
.lit-index a.lit-tag { cursor: pointer; }
.lit-index a.lit-tag.lit-tag-active {
  background: color-mix(in srgb, var(--secondary) 22%, transparent);
  color: var(--secondary);
  font-weight: 600;
}
.lit-result {
  margin-left: auto;
  font-size: 0.78rem; color: var(--gray);
  font-variant-numeric: tabular-nums;
}
/* stamp shown on cards when the list is flattened by sorting */
.lit-index .lit-added {
  font-size: 0.72rem; color: var(--gray);
  background: var(--lightgray);
  border-radius: 4px; padding: 0 0.45rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* flat container used when a sort other than the default grouping is active */
.lit-index .lit-flat {
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: 0.85rem;
}
.lit-index .lit-flat.lit-hidden { display: none; }
@media all and (max-width: 640px) {
  .lit-result { display: none; }
  .lit-toolbar-search { flex-basis: 100%; }
}

/* ---- mobile horizontal quick-nav (hidden on desktop: left sidebar nav takes over) ---- */
.lit-nav {
  display: flex; flex-wrap: nowrap; gap: 0.5rem;
  margin-block: 1rem 1.5rem;
  overflow-x: auto; padding-bottom: 0.3rem;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.lit-nav::-webkit-scrollbar { display: none; }
.lit-nav-link {
  font-size: 0.82rem;
  display: inline-flex; align-items: center; gap: 0.4rem;
  white-space: nowrap;
  border: 1px solid var(--lightgray);
  border-radius: 999px;
  padding: 0.25rem 0.85rem;
  color: var(--darkgray);
  background: none;
}
.lit-nav-link:hover {
  border-color: var(--secondary);
  color: var(--secondary);
}
.lit-nav-count {
  font-size: 0.85em; color: var(--gray);
  font-variant-numeric: tabular-nums;
}
@media all and (min-width: 800px) {
  .lit-nav { display: none; }
  .lit-group { scroll-margin-top: 1.5rem; }
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

/** Tag namespaces we take over from the generic TagPage. */
const TAGGED_NS = ["topic", "method", "area", "task", "hardware", "software", "type", "source"]
const isLitTagSlug = (slug: string): boolean => {
  if (slug === "tags" || slug === "tags/index") return true
  if (!slug.startsWith("tags/")) return false
  const ns = slug.split("/")[1]
  return TAGGED_NS.includes(ns)
}

const LiteratureIndexPage: QuartzPageTypePlugin = () => ({
  name: "LiteratureIndexPage",
  // Must beat TagPage (priority 10) so our unified card list + toolbar wins
  priority: 20,
  match: ({ slug }) => LIT_SLUGS.has(slug) || isLitTagSlug(slug),
  layout: "content",
  body: LiteratureBody,
  // All tag pages (virtual or content) belong to us now — TagPage is disabled.
  generate: ({ content }) => {
    // collect every tag from published files (all namespaces)
    const tagSet = new Set<string>()
    for (const [, file] of content) {
      const fm = (file.data?.frontmatter ?? {}) as Fm
      const tags: string[] = fm.tags ?? []
      for (const t of tags) tagSet.add(`tags/${t}`)
    }
    tagSet.add("tags/index") // the tag index page
    // avoid duplicates with real content files
    const existing = new Set<string>()
    for (const [, file] of content) {
      const s = file.data?.slug
      if (s && s.startsWith("tags/")) existing.add(s)
    }
    const virtualPages: { slug: string; title: string; data: Record<string, unknown> }[] = []
    for (const slug of tagSet) {
      if (existing.has(slug) || slug === "tags") continue
      virtualPages.push({ slug, title: slug.split("/").slice(1).join("/"), data: {} })
    }
    return virtualPages
  },
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
