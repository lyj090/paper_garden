import type { PluggableList } from "unified"
import type { QuartzFilterPlugin, QuartzTransformerPlugin } from "@quartz-community/types"
import { rehypeStripPrivate } from "./rehype.ts"

/**
 * Privacy plugin — reading status / plan (status/* tags, 阅读记录 links,
 * 精读状态 notes) never reaches any emitter: tag pages, search index,
 * sitemap, RSS and note properties all see cleaned data.
 *
 * The vault itself is untouched; this only affects the public build.
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
        (t) => typeof t === "string" && !t.startsWith("status/"),
      )
    }
    return true
  },
})

export { PrivacyTransformer, PrivacyFilter }
