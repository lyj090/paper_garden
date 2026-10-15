import type { Plugin } from "unified"
import type { Root } from "hast"
import { visit } from "unist-util-visit"

// No personal vocabulary belongs in this public module. The exporter reads
// private policy before staging; this plugin is a second structural guard.
export const PUBLIC_TAG_RE = /^(type|area|topic|method|task|software|hardware)\/[a-z0-9][a-z0-9_/-]*$/
export function isPrivateTag(tag: string): boolean { return !PUBLIC_TAG_RE.test(tag) }
export function isPersonalSectionHeading(text: string): boolean {
  return /^(?:\d+[.、]\s*)?(?:项目关联(?:与本笔记判读)?|本笔记判读|我的(?:判读|判断|批注|理解|启发|看法|评价)|私人笔记|Personal Notes|My Notes)(?:\s|[:：（(]|$)/i.test(text.trim())
}
function textOf(node: any): string {
  return node.value ?? (node.children ?? []).map(textOf).join("")
}
export const rehypeStripPrivate = (): Plugin<[], Root> => () => (tree, file: any) => {
  const fm = file.data?.frontmatter
  if (fm?.publication_schema !== 2 || fm?.publish !== true) throw new Error("unstaged-publication-input")
  const allowed = new Set(["publication_schema", "publish", "title", "authors", "year", "date", "author", "venue", "doi", "arxiv", "url", "code_url", "project_url", "note_contract", "tags"])
  for (const key of Object.keys(fm)) if (!allowed.has(key)) delete fm[key]
  if (Array.isArray(fm.tags)) fm.tags = fm.tags.filter((t: unknown) => typeof t === "string" && PUBLIC_TAG_RE.test(t))
  const children: any[] = tree.children
  const boundary = children.findIndex((n) => n.type === "element" && /^h[1-6]$/.test(n.tagName) && isPersonalSectionHeading(textOf(n)))
  if (boundary >= 0) children.splice(boundary)
  if (Array.isArray(file.data.toc)) {
    const end = file.data.toc.findIndex((n: any) => isPersonalSectionHeading(n.text ?? ""))
    if (end >= 0) file.data.toc.splice(end)
  }
  visit(tree, "element", (node: any) => {
    for (const value of Object.values(node.properties ?? {})) {
      if (typeof value === "string" && /(?:zotero|obsidian|file):\/\/|\/home\/|\/Users\//i.test(value)) throw new Error("private-html-attribute")
    }
  })
}
