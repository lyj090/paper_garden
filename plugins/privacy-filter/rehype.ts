import type { PluggableList, Plugin } from "unified"
import type { Root as HastRoot } from "hast"
import { visit } from "unist-util-visit"

/**
 * Privacy transform (html phase) — runs inside the unified html pipeline,
 * BEFORE the description transformer serializes the page text used by the
 * search index. Removes reading-status tags, reading-log links and any
 * 精读状态/阅读管理 phrasing so nothing private reaches tag pages, search,
 * sitemap, RSS or note properties. The vault itself is untouched.
 */

const PRIVATE_TEXT_PATTERNS = [
  "精读状态",
  "阅读管理",
  "阅读计划",
  "论文阅读记录",
  "status/deep-read",
  "status/to-read",
]

function isPrivateHref(href: string): boolean {
  const decoded = (() => {
    try {
      return decodeURIComponent(href)
    } catch {
      return href
    }
  })()
  return decoded.includes("/tags/status/") || decoded.includes("论文阅读记录")
}

function cleanText(value: string): string {
  for (const p of PRIVATE_TEXT_PATTERNS) {
    if (!value.includes(p)) continue
    value = value
      .split(/(?<=[。；;.\n])|(?=[。；;\n])/)
      .filter((seg) => !seg.includes(p))
      .join("")
  }
  return value
}

function textOf(el: any): string {
  let out = ""
  for (const c of el.children ?? []) {
    if (c.type === "text") out += c.value ?? ""
    else if (c.type === "element") out += textOf(c)
  }
  return out
}

export const rehypeStripPrivate = (): Plugin<[], HastRoot> => {
  return () => (tree: HastRoot, file: any) => {
    // 1. remove private tags from frontmatter (tags pages, properties view, search)
    const fm = file.data?.frontmatter as Record<string, unknown> | undefined
    if (fm && Array.isArray(fm.tags)) {
      fm.tags = (fm.tags as string[]).filter(
        (t) => typeof t === "string" && !t.startsWith("status/"),
      )
    }

    // note-properties keeps its own copy of the frontmatter — scrub it too
    const noteProps = file.data?.noteProperties as
      | { properties?: Record<string, unknown> }
      | undefined
    if (noteProps?.properties && Array.isArray(noteProps.properties.tags)) {
      noteProps.properties.tags = (noteProps.properties.tags as string[]).filter(
        (t) => typeof t === "string" && !t.startsWith("status/"),
      )
    }

    // 2. neutralize links to private pages (keep anchor text context)
    visit(tree, "element", (node: any) => {
      if (node.tagName === "a" && node.properties?.href) {
        if (isPrivateHref(String(node.properties.href))) {
          node.tagName = "span"
          delete node.properties.href
          delete node.properties.className
          delete node.properties.dataSlug
        }
      }
    })

    // 3. remove list items / paragraphs that describe the reading plan
    visit(tree, "element", (node: any, index, parent) => {
      if (!parent || typeof index !== "number") return
      if (node.tagName !== "p" && node.tagName !== "li") return
      const text = textOf(node)
      if (
        text.includes("精读状态") ||
        text.includes("阅读管理") ||
        text.includes("阅读计划") ||
        text.includes("已精读 / 入库未精读") ||
        text.includes("由 tag 自动维护")
      ) {
        parent.children.splice(index, 1)
        return index
      }
    })

    // 4. remove personal-plan sections (heading + everything up to next same-level heading)
    visit(tree, "element", (node: any, index, parent) => {
      if (!parent || typeof index !== "number") return
      if (!/^h[1-6]$/.test(node.tagName)) return
      const level = parseInt(node.tagName[1], 10)
      const heading = textOf(node)
      if (!/明日|精读建议|阅读计划|阅读顺序/.test(heading)) return
      let end = parent.children.length
      for (let j = index + 1; j < parent.children.length; j++) {
        const sib = parent.children[j]
        if (sib.type === "element" && /^h[1-6]$/.test(sib.tagName)) {
          if (parseInt(sib.tagName[1], 10) <= level) {
            end = j
            break
          }
        }
      }
      parent.children.splice(index, end - index)
      return index
    })

    // 5. scrub remaining private phrases from text nodes (search index safety)
    visit(tree, "text", (node: any) => {
      if (
        typeof node.value === "string" &&
        PRIVATE_TEXT_PATTERNS.some((p) => node.value.includes(p))
      ) {
        node.value = cleanText(node.value)
      }
    })
  }
}
