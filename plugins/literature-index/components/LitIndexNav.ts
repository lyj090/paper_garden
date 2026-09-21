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
 *  - `index` (homepage): compact "浏览" menu — 文献索引 / 主题标签 / 文件夹.
 *    The Explorer tree is hidden via CSS there (the public site only exposes
 *    02-Literature, so the default tree is a single lonely folder).
 *  - `02-literature/**` pages: 分区 (paper counts per area/) + 常用主题 tags.
 *  - other pages (folder/tag listings, notes): the same literature nav as a
 *    "文献区" shortcut section, collapsed under the Explorer.
 */

const PREFIX = "02-literature"

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

  // --- homepage: compact browse menu --------------------------------------
  if (slug === "index") {
    const link = (label: string, target: string, desc?: string) =>
      h(
        "a",
        { href: resolveRelative(slug, target), class: "lit-leftnav-link" },
        h("span", { class: "lit-leftnav-label" }, label),
        desc ? h("span", { class: "lit-leftnav-desc" }, desc) : null,
      )
    return h(
      "div",
      { class: "lit-leftnav" },
      h("div", { class: "lit-leftnav-title" }, "浏览"),
      link("📚 文献索引", `${PREFIX}/index`),
      link("🏷️ 主题标签", "tags/index"),
      link("🗂️ 文件夹", "tags/topic/index"),
    )
  }

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

  // area groups
  const byArea = new Map<string, number>()
  for (const e of entries) {
    const areas = e.areas.length > 0 ? e.areas : ["other"]
    for (const a of new Set(areas)) byArea.set(a, (byArea.get(a) ?? 0) + 1)
  }
  const areaLinks = AREA_ORDER.filter((a) => byArea.has(a))
  for (const a of byArea.keys()) {
    if (!AREA_ORDER.includes(a) && a !== "other" && !areaLinks.includes(a)) areaLinks.push(a)
  }

  // top topics
  const topicCounts = new Map<string, number>()
  for (const e of entries) {
    for (const t of new Set(e.topics)) topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1)
  }
  const topTopics = [...topicCounts.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  // --- literature pages (incl. tag pages): full nav; others: shortcut -----
  const inLit = slug.startsWith(`${PREFIX}/`) || slug.startsWith("tags/")
  const areaEls = areaLinks.map((a) =>
    h(
      "a",
      {
        href: resolveRelative(slug, `${PREFIX}/index`) + `#${a}`,
        class: "lit-leftnav-link",
      },
      h("span", { class: "lit-leftnav-label" }, AREA_LABELS[a] ?? a),
      h("span", { class: "lit-leftnav-count" }, String(byArea.get(a) ?? 0)),
    ),
  )
  const topicEls = topTopics.map(([t, n]) =>
    h(
      "a",
      { href: resolveRelative(slug, `tags/${t}`), class: "lit-leftnav-link lit-leftnav-topic" },
      h("span", { class: "lit-leftnav-label" }, t.split("/")[1] ?? t),
      h("span", { class: "lit-leftnav-count" }, String(n)),
    ),
  )

  if (inLit) {
    // full tag cloud with counts — data-tag attrs let the filter controller
    // turn these into client-side toggles on any lit page
    const allTagCounts = new Map<string, number>()
    for (const e of entries) {
      for (const t of new Set(e.topics)) allTagCounts.set(t, (allTagCounts.get(t) ?? 0) + 1)
    }
    const allTagEls = [...allTagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) =>
        h(
          "a",
          {
            href: resolveRelative(slug, `tags/${t}`),
            class: "lit-leftnav-link lit-leftnav-topic",
            "data-tag": t,
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

const css = `
.lit-leftnav { display: none; }

/* --- homepage: compact browse menu, Explorer hidden (tree is one lonely
   folder since the rest of the vault is private) --- */
body[data-slug="index"] .lit-leftnav {
  display: flex; flex-direction: column; gap: 0.1rem;
  padding: 0.25rem 0 0.75rem;
  margin-bottom: 0.5rem;
}
body[data-slug="index"] .lit-leftnav-title {
  font-size: 0.68rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--gray);
  margin-block: 0.3rem 0.25rem;
}
body[data-slug="index"] .lit-leftnav-link {
  display: flex; align-items: center; gap: 0.5rem;
  font-size: 0.82rem;
  padding: 0.22rem 0.45rem;
  border-radius: 6px;
  color: var(--darkgray);
}
body[data-slug="index"] .lit-leftnav-link:hover {
  background: color-mix(in srgb, var(--secondary) 8%, transparent);
  color: var(--secondary);
}
body[data-slug="index"] .lit-leftnav-desc {
  margin-left: auto;
  font-size: 0.66rem;
  color: var(--gray);
}
body[data-slug="index"] .explorer { display: none; }

/* --- literature pages: full 分区 + 常用主题 nav --- */
body[data-slug^="02-literature"], body[data-slug^="tags"] .lit-leftnav,
body[data-slug="02-literature"] .lit-leftnav {
  display: flex; flex-direction: column; gap: 0.1rem;
  padding: 0.25rem 0 0.75rem;
  margin-bottom: 0.5rem;
  border-bottom: 1px solid var(--lightgray);
}
body[data-slug^="02-literature"] .lit-leftnav-title,
body[data-slug^="tags"] .lit-leftnav-title,
body[data-slug="02-literature"] .lit-leftnav-title {
  font-size: 0.68rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--gray);
  margin-block: 0.3rem 0.25rem;
}
body[data-slug^="02-literature"] .lit-leftnav-section,
body[data-slug^="tags"] .lit-leftnav-section,
body[data-slug="02-literature"] .lit-leftnav-section {
  border-top: 1px solid var(--lightgray);
  margin-top: 0.35rem; padding-top: 0.15rem;
}
body[data-slug^="02-literature"] .lit-leftnav-link,
body[data-slug^="tags"] .lit-leftnav-link,
body[data-slug="02-literature"] .lit-leftnav-link {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.6rem;
  font-size: 0.78rem;
  padding: 0.16rem 0.45rem;
  border-radius: 6px;
  color: var(--darkgray);
}
body[data-slug^="02-literature"] .lit-leftnav-link:hover,
body[data-slug^="tags"] .lit-leftnav-link:hover,
body[data-slug="02-literature"] .lit-leftnav-link:hover {
  background: color-mix(in srgb, var(--secondary) 8%, transparent);
  color: var(--secondary);
}
body[data-slug^="02-literature"] .lit-leftnav-count,
body[data-slug^="tags"] .lit-leftnav-count,
body[data-slug="02-literature"] .lit-leftnav-count {
  font-size: 0.7rem; color: var(--gray);
  font-variant-numeric: tabular-nums;
}
body[data-slug^="tags"] .lit-leftnav-tags,
body[data-slug^="02-literature"] .lit-leftnav-tags,
body[data-slug^="tags"] .lit-leftnav-tags,
body[data-slug="02-literature"] .lit-leftnav-tags {
  max-height: 14rem;
  overflow-y: auto;
  scrollbar-width: thin;
}
body[data-slug^="tags"] .lit-leftnav-link.lit-tag-active,
body[data-slug^="02-literature"] .lit-leftnav-link.lit-tag-active,
body[data-slug^="tags"] .lit-leftnav-link.lit-tag-active,
body[data-slug="02-literature"] .lit-leftnav-link.lit-tag-active {
  background: color-mix(in srgb, var(--secondary) 14%, transparent);
  color: var(--secondary);
  font-weight: 600;
}
body[data-slug^="02-literature"] .lit-leftnav-topic .lit-leftnav-label::before,
body[data-slug^="tags"] .lit-leftnav-topic .lit-leftnav-label::before,
body[data-slug="02-literature"] .lit-leftnav-topic .lit-leftnav-label::before {
  content: "#"; opacity: 0.5; margin-right: 0.1rem;
}

/* --- other pages (folder / tag listings): 文献区 shortcut only --- */
body:not([data-slug="index"]):not([data-slug^="02-literature"]) .lit-leftnav {
  display: flex; flex-direction: column; gap: 0.1rem;
  padding: 0.5rem 0 0.75rem;
}
body:not([data-slug="index"]):not([data-slug^="02-literature"]) .lit-leftnav-title {
  font-size: 0.68rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--gray);
  margin-block: 0.3rem 0.25rem;
}
body:not([data-slug="index"]):not([data-slug^="02-literature"]) .lit-leftnav-link {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.6rem;
  font-size: 0.78rem;
  padding: 0.16rem 0.45rem;
  border-radius: 6px;
  color: var(--darkgray);
}
body:not([data-slug="index"]):not([data-slug^="02-literature"]) .lit-leftnav-link:hover {
  background: color-mix(in srgb, var(--secondary) 8%, transparent);
  color: var(--secondary);
}
body:not([data-slug="index"]):not([data-slug^="02-literature"]) .lit-leftnav-count {
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
