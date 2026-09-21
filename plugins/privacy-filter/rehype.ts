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

/**
 * Tag namespaces that never appear on the public site:
 *  - status/*  reading lifecycle (private)
 *  - rel/*     thesis / project relationships (private)
 *  - proj/*    private project bindings
 *  - source/*  venue origin — redundant, the venue frontmatter badge shows it
 * Individual tags: type/paper is the default on every paper note (zero signal);
 * type/survey, type/benchmark, type/dataset stay since they are informative.
 */
const PRIVATE_TAG_PREFIXES = ["status/", "rel/", "proj/", "source/"]
const PRIVATE_TAG_NAMES = new Set(["type/paper"])

export function isPrivateTag(tag: string): boolean {
  return PRIVATE_TAG_NAMES.has(tag) || PRIVATE_TAG_PREFIXES.some((p) => tag.startsWith(p))
}

function filterTags(tags: unknown): string[] | null {
  if (!Array.isArray(tags)) return null
  const kept = (tags as unknown[]).filter(
    (t) => typeof t === "string" && !isPrivateTag(t),
  ) as string[]
  return kept
}

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
      fm.tags = filterTags(fm.tags)
    }

    // note-properties keeps its own copy of the frontmatter — scrub it too
    const noteProps = file.data?.noteProperties as
      | { properties?: Record<string, unknown> }
      | undefined
    if (noteProps?.properties && Array.isArray(noteProps.properties.tags)) {
      noteProps.properties.tags = filterTags(noteProps.properties.tags)
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

    // 5. remove dataview code blocks on any page (Quartz cannot execute them,
    //    and their query text leaks vault-internal details into search)
    visit(tree, "element", (node: any, index, parent) => {
      if (!parent || typeof index !== "number") return
      const lang = node.properties?.dataLanguage ?? node.properties?.data_language
      const cls = Array.isArray(node.properties?.className)
        ? (node.properties.className as string[]).join(" ")
        : String(node.properties?.className ?? "")
      const isDv =
        lang === "dataview" ||
        cls.includes("language-dataview") ||
        cls.includes("dataview") ||
        (node.tagName === "figure" && JSON.stringify(node.children ?? []).includes("dataview"))
      if (isDv) {
        parent.children.splice(index, 1)
        return index
      }
    })

    // 6. scrub tool paths and private phrases from text nodes (search index safety)
    visit(tree, "text", (node: any) => {
      if (
        typeof node.value === "string" &&
        (PRIVATE_TEXT_PATTERNS.some((p) => node.value.includes(p)) ||
          /zotero_cli|ai-workflows|\.scripts\//.test(node.value))
      ) {
        node.value = cleanText(node.value)
        for (const re of [
          /zotero_cli[^\s,;)。]*\.?/g,
          /ai-workflows[^\s,;)。]*/g,
          /\.scripts\/[^\s,;)。]*/g,
        ]) {
          node.value = node.value.replace(re, "")
        }
      }
    })
  }
}
