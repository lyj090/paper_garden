import type { PluggableList } from "unified"
import type { QuartzFilterPlugin, QuartzTransformerPlugin } from "@quartz-community/types"
import { rehypeStripPrivate, isPrivateTag, PUBLIC_TAG_RE } from "./rehype.ts"

/**
 * Privacy plugin — reading status, thesis/project relationships and
 * redundant bookkeeping tags (status/*, rel/*, proj/*, source/*, type/paper)
 * never reach any emitter: tag pages, search index, sitemap, RSS and note
 * properties all see cleaned data. The vault itself is untouched.
 *
 * Exports two factories; the loader probes each for its matching category:
 *  - PrivacyTransformer (transformer): html-phase scrub (text, links, tags)
 *  - PrivacyFilter (filter): frontmatter tag removal before emit
 */

const PrivacyTransformer: QuartzTransformerPlugin = () => ({
  name: "PrivacyTransformer",
  htmlPlugins(): PluggableList {
    return [rehypeStripPrivate()]
  },
})

const PrivacyFilter: QuartzFilterPlugin = () => ({
  name: "PrivacyFilter",
  shouldPublish(_ctx, [_tree, vfile]) {
    const fm = vfile.data?.frontmatter as Record<string, unknown> | undefined
    if (fm && Array.isArray(fm.tags)) {
      fm.tags = (fm.tags as string[]).filter(
        (t) => typeof t === "string" && !isPrivateTag(t) && PUBLIC_TAG_RE.test(t),
      )
    }
    return true
  },
})

export { PrivacyTransformer, PrivacyFilter }
export { isPrivateTag, PUBLIC_TAG_RE }
