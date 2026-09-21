import { h } from "preact"
import type {
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
  StringResource,
} from "@quartz-community/types"
import { resolveRelative } from "@quartz-community/utils/path"

/**
 * LitIndexNav — left-sidebar navigation for the literature index page.
 * Renders inside .left.sidebar (above Explorer) on the index page only;
 * other pages render nothing. Data is computed from allFiles at render time.
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
  // 渲染时数据不足(如 registry 预实例化)则输出空壳,CSS 只在 index 页显示
  const fileData = props?.fileData as { slug?: string } | undefined
  const allFiles = (props?.allFiles ?? []) as {
    slug?: string
    frontmatter?: Record<string, any>
  }[]
  if (!fileData || !fileData.slug) return h("div", { class: "lit-leftnav" })

  const slug = fileData.slug

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

  return h(
    "div",
    { class: "lit-leftnav" },
    h("div", { class: "lit-leftnav-title" }, "文献分区"),
    areaLinks.map((a) =>
      h(
        "a",
        { href: resolveRelative(slug, `${PREFIX}/index`) + `#${a}`, class: "lit-leftnav-link" },
        h("span", { class: "lit-leftnav-label" }, AREA_LABELS[a] ?? a),
        h("span", { class: "lit-leftnav-count" }, String(byArea.get(a) ?? 0)),
      ),
    ),
    topTopics.length > 0 &&
      h(
        "div",
        { class: "lit-leftnav-section" },
        h("div", { class: "lit-leftnav-title" }, "常用主题"),
        topTopics.map(([t, n]) =>
          h(
            "a",
            {
              href: resolveRelative(slug, `tags/${t}`),
              class: "lit-leftnav-link lit-leftnav-topic",
            },
            h("span", { class: "lit-leftnav-label" }, t.split("/")[1] ?? t),
            h("span", { class: "lit-leftnav-count" }, String(n)),
          ),
        ),
      ),
  )
}

const css = `
.lit-leftnav { display: none; }
body[data-slug="02-literature/index"] .lit-leftnav {
  display: flex; flex-direction: column; gap: 0.1rem;
  padding: 0.25rem 0 0.75rem;
  margin-bottom: 0.5rem;
  border-bottom: 1px solid var(--lightgray);
}
body[data-slug="02-literature/index"] .lit-leftnav-title {
  font-size: 0.68rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--gray);
  margin-block: 0.3rem 0.25rem;
}
body[data-slug="02-literature/index"] .lit-leftnav-section {
  border-top: 1px solid var(--lightgray);
  margin-top: 0.35rem; padding-top: 0.15rem;
}
body[data-slug="02-literature/index"] .lit-leftnav-link {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.6rem;
  font-size: 0.78rem;
  padding: 0.16rem 0.45rem;
  border-radius: 6px;
  color: var(--darkgray);
}
body[data-slug="02-literature/index"] .lit-leftnav-link:hover {
  background: color-mix(in srgb, var(--secondary) 8%, transparent);
  color: var(--secondary);
}
body[data-slug="02-literature/index"] .lit-leftnav-count {
  font-size: 0.7rem; color: var(--gray);
  font-variant-numeric: tabular-nums;
}
body[data-slug="02-literature/index"] .lit-leftnav-topic .lit-leftnav-label::before {
  content: "#"; opacity: 0.5; margin-right: 0.1rem;
}
@media all and (max-width: 800px) {
  body[data-slug="02-literature/index"] .lit-leftnav { display: none; }
}
`.trim()

;(LitIndexNavComponent as any).css = css as StringResource

export const LitIndexNav = (() => LitIndexNavComponent) as unknown as QuartzComponentConstructor
export default LitIndexNav
