import type { QuartzFilterPlugin, QuartzTransformerPlugin } from "@quartz-community/types"
import { rehypeStripPrivate } from "./rehype.ts"

const PrivacyTransformer: QuartzTransformerPlugin = () => ({
  name: "PrivacyTransformer",
  htmlPlugins() { return [rehypeStripPrivate()] },
})
const PrivacyFilter: QuartzFilterPlugin = () => ({
  name: "PrivacyFilter",
  shouldPublish(_ctx, [_tree, file]) {
    const fm = file.data?.frontmatter as Record<string, unknown> | undefined
    return fm?.publication_schema === 2 && fm?.publish === true
  },
})
export { PrivacyTransformer, PrivacyFilter }
export { isPrivateTag, PUBLIC_TAG_RE } from "./rehype.ts"
