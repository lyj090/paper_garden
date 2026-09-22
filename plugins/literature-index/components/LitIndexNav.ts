import { h } from "preact"
import type {
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
  StringResource,
} from "@quartz-community/types"
import { resolveRelative } from "@quartz-community/utils/path"

/**
 * LitIndexNav — left-sidebar navigation for the literature area.
 *
 * Rendered on every page (global component); the visible branch depends on
 * the current slug:
 *  - site root (`index`, which renders the tag index) and `tags/**` pages:
 *    分区 + full 主题标签 cloud with the active tag highlighted.
 *  - `02-literature/**` pages incl. paper notes: 分区 + 主题标签 cloud, the
 *    note's own topic/method tags highlighted so the sidebar mirrors the page.
 *  - other pages: a "文献区" shortcut section only.
 */

const PREFIX = "02-literature"

/** Tag namespaces with dedicated tag pages (kept in sync with index.ts). */
const TAGGED_NS = ["topic", "method", "area", "task", "hardware", "software", "type", "source"]

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

interface NavEntry {
  slug: string
  areas: string[]
  topics: string[]
}

const LitIndexNavComponent: QuartzComponent = (props: QuartzComponentProps) => {
  // 渲染时数据不足(如 registry 预实例化)则输出空壳,CSS 只在对应页面显示
  const fileData = props?.fileData as { slug?: string } | undefined
  const allFiles = (props?.allFiles ?? []) as {
    slug?: string
    frontmatter?: Record<string, any>
  }[]
  if (!fileData || !fileData.slug) return h("div", { class: "lit-leftnav" })

  const slug = fileData.slug

  // --- homepage: same full nav as the tag index (the root IS the tag index)

  const entries: NavEntry[] = []
  for (const data of allFiles) {
    const s = data.slug
    if (!s || !s.startsWith(`${PREFIX}/`) || s.endsWith("/index")) continue
    if (s === `${PREFIX}/02-literature-moc`) continue
    const tags: string[] = data.frontmatter?.tags ?? []
    entries.push({
      slug: s,
      areas: tags.filter((t) => t.startsWith("area/")).map((t) => t.slice("area/".length)),
      topics: tags.filter((t) => t.startsWith("topic/") || t.startsWith("method/")),
    })
  }

  // area groups — links jump to the index page's per-area sections
  const byArea = new Map<string, number>()
  for (const e of entries) {
    const areas = e.areas.length > 0 ? e.areas : ["other"]
    for (const a of new Set(areas)) byArea.set(a, (byArea.get(a) ?? 0) + 1)
  }
  const areaLinks = AREA_ORDER.filter((a) => byArea.has(a))
  for (const a of byArea.keys()) {
    if (!AREA_ORDER.includes(a) && a !== "other" && !areaLinks.includes(a)) areaLinks.push(a)
  }

  // --- literature pages (incl. tag pages & site root): full nav; others: shortcut
  const inLit =
    slug === "index" || slug.startsWith(`${PREFIX}/`) || slug.startsWith("tags/")
  const indexSlug = `${PREFIX}/index`
  const areaEls = areaLinks.map((a) =>
    h(
      "a",
      {
        href: resolveRelative(slug, indexSlug) + `#${a}`,
        class: "lit-leftnav-link",
      },
      h("span", { class: "lit-leftnav-label" }, AREA_LABELS[a] ?? a),
      h("span", { class: "lit-leftnav-count" }, String(byArea.get(a) ?? 0)),
    ),
  )

  if (inLit) {
    // tag cloud with counts — plain links: one tag = one page. The tags of
    // the page currently being viewed (its own tag on tag pages, or the
    // note's tags on paper pages) are highlighted, so the sidebar always
    // mirrors what the page is about.
    const allTagCounts = new Map<string, number>()
    for (const e of entries) {
      for (const t of new Set(e.topics)) allTagCounts.set(t, (allTagCounts.get(t) ?? 0) + 1)
    }
    // tags of the current page
    const activeTags = new Set(
      ((fileData.frontmatter?.tags as string[] | undefined) ?? []).filter(
        (t) => t.startsWith("topic/") || t.startsWith("method/"),
      ),
    )
    if (slug.startsWith("tags/") && TAGGED_NS.includes(slug.split("/")[1])) {
      activeTags.add(slug.split("/").slice(1).join("/"))
    }
    const allTagEls = [...allTagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) =>
        h(
          "a",
          {
            href: resolveRelative(slug, `tags/${t}`),
            class:
              "lit-leftnav-link lit-leftnav-topic" +
              (activeTags.has(t) ? " lit-tag-active" : ""),
          },
          h("span", { class: "lit-leftnav-label" }, t.split("/")[1] ?? t),
          h("span", { class: "lit-leftnav-count" }, String(n)),
        ),
      )
    return h(
      "div",
      { class: "lit-leftnav" },
      h("div", { class: "lit-leftnav-title" }, "文献分区"),
      areaEls,
      allTagEls.length > 0 &&
        h(
          "div",
          { class: "lit-leftnav-section lit-leftnav-tags" },
          h("div", { class: "lit-leftnav-title" }, "主题标签"),
          allTagEls,
        ),
    )
  }

  // non-literature pages: only the shortcut section, no topic list
  return h(
    "div",
    { class: "lit-leftnav" },
    h(
      "div",
      { class: "lit-leftnav-section" },
      h("div", { class: "lit-leftnav-title" }, "文献区"),
      areaEls,
    ),
  )
}

/* pages that carry the full literature nav: site root (tag index),
   tag pages, and the 02-literature area pages. Each base selector gets
   the descendant part appended individually — a bare comma list would
   leave it attached only to the last item. */
const SCOPE_BASES = [
  'body[data-slug="index"]',
  'body[data-slug^="tags"]',
  'body[data-slug^="02-literature"]',
]
const OTHER_BASE =
  'body:not([data-slug="index"]):not([data-slug^="02-literature"]):not([data-slug^="tags"])'
const scope = (descendant: string) =>
  SCOPE_BASES.map((b) => `${b} ${descendant}`).join(", ")

const css = `
.lit-leftnav { display: none; }

${scope(".lit-leftnav")} {
  display: flex; flex-direction: column; gap: 0.1rem;
  padding: 0.25rem 0 0.75rem;
  margin-bottom: 0.5rem;
  border-bottom: 1px solid var(--lightgray);
}
${scope(".lit-leftnav-title")} {
  font-size: 0.68rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--gray);
  margin-block: 0.3rem 0.25rem;
}
${scope(".lit-leftnav-section")} {
  border-top: 1px solid var(--lightgray);
  margin-top: 0.35rem; padding-top: 0.15rem;
}
${scope(".lit-leftnav-link")} {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.6rem;
  font-size: 0.78rem;
  padding: 0.16rem 0.45rem;
  border-radius: 6px;
  color: var(--darkgray);
}
${scope(".lit-leftnav-link:hover")} {
  background: color-mix(in srgb, var(--secondary) 8%, transparent);
  color: var(--secondary);
}
${scope(".lit-leftnav-count")} {
  font-size: 0.7rem; color: var(--gray);
  font-variant-numeric: tabular-nums;
}
${scope(".lit-leftnav-tags")} {
  max-height: 14rem;
  overflow-y: auto;
  scrollbar-width: thin;
}
${scope(".lit-leftnav-link.lit-tag-active")} {
  background: color-mix(in srgb, var(--secondary) 14%, transparent);
  color: var(--secondary);
  font-weight: 600;
}
${scope(".lit-leftnav-topic .lit-leftnav-label::before")} {
  content: "#"; opacity: 0.5; margin-right: 0.1rem;
}
body[data-slug="index"] .explorer { display: none; }

/* --- other pages: short-cut only --- */
${OTHER_BASE} .lit-leftnav {
  display: flex; flex-direction: column; gap: 0.1rem;
  padding: 0.5rem 0 0.75rem;
}
${OTHER_BASE} .lit-leftnav-title {
  font-size: 0.68rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--gray);
  margin-block: 0.3rem 0.25rem;
}
${OTHER_BASE} .lit-leftnav-link {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.6rem;
  font-size: 0.78rem;
  padding: 0.16rem 0.45rem;
  border-radius: 6px;
  color: var(--darkgray);
}
${OTHER_BASE} .lit-leftnav-link:hover {
  background: color-mix(in srgb, var(--secondary) 8%, transparent);
  color: var(--secondary);
}
${OTHER_BASE} .lit-leftnav-count {
  font-size: 0.7rem; color: var(--gray);
  font-variant-numeric: tabular-nums;
}

@media all and (max-width: 800px) {
  .lit-leftnav { display: none !important; }
}
`.trim()

;(LitIndexNavComponent as any).css = css as StringResource

export const LitIndexNav = (() => LitIndexNavComponent) as unknown as QuartzComponentConstructor
export default LitIndexNav
