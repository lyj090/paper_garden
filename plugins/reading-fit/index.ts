import type { QuartzTransformerPlugin } from "@quartz-community/types"

/**
 * Reading-fit — client-side adjustments that CSS cannot express.
 *
 * Three things in these notes are invisible to CSS because the source Markdown
 * is plain (no classes, no Obsidian image-size syntax):
 *
 *  1. Wide figures. A figure with aspect >= 2 (the multi-camera setup
 *     schematics, the 3D annotation room) is squeezed into the 46rem measure
 *     and becomes an unreadable strip. CSS has no `:has(img[aspect>=2])`, so
 *     the break-out class is added here once the image has loaded and its
 *     intrinsic size is known.
 *
 *  2. Template headings in the table of contents. Every Zotero note opens
 *     with `## 快捷链接` (Zotero/PDF jump links, useless on the web) and
 *     repeats `### Takeaway（§n）` at the end of each section. They are
 *     boilerplate, not structure, and they push the real hierarchy out of
 *     sight. Filtering them at build time would need the transformer in
 *     `.quartz/plugins/` (overwritten by `prebuild`), so it is done here
 *     against the rendered DOM instead.
 *
 *  3. Emoji-led blockquote callouts. The notes' annotation system is a plain
 *     `>` quote whose first character is an emoji, and the emoji is the type:
 *     📌 fact, 💡 transferable insight, ⚠️ caveat (160 uses across the vault).
 *     Rendering them identically throws the type away. CSS cannot select on
 *     text content, so the emoji is wrapped in a span carrying a class that
 *     custom.scss keys off.
 *
 * The script runs on `nav` as well as first load, because this site is an SPA
 * (enableSPA: true) and `window.addCleanup` is the documented teardown hook.
 */
const FIGURE_AND_TOC_SCRIPT = `
(function () {
  // Headings that are template scaffolding rather than content structure.
  // Matched exactly so a genuine section named "关联" in some future note is
  // still listed; these are the fixed Zotero-note preamble/outro.
  var TOC_NOISE = [
    "快捷链接",
    "Takeaway（§1）",
    "Takeaway（§2）",
    "Takeaway（§3）",
    "Takeaway（§4）",
    "Takeaway（§5）"
  ];

  // Leading emoji -> annotation type. Kept as a table so a new marker is one
  // line, and so the mapping lives next to the counts it was derived from.
  var CALLOUT_MARKERS = [
    { emoji: "\\u{1F4CC}", cls: "callout-lead-pin" },  // 📌 fact from the paper
    { emoji: "\\u{1F4A1}", cls: "callout-lead-idea" }, // 💡 transferable insight
    { emoji: "\\u26A0", cls: "callout-lead-warn" }     // ⚠️ caveat
  ];

  function fitFigures() {
    var article = document.querySelector(".center > article");
    if (!article) return;
    var figures = article.querySelectorAll("p:has(> img:only-child)");
    figures.forEach(function (p) {
      var img = p.querySelector("img");
      if (!img) return;
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      if (!w || !h) {
        // Not decoded yet: classify once it is.
        if (!img.dataset.fitPending) {
          img.dataset.fitPending = "1";
          img.addEventListener("load", function () {
            img.removeAttribute("data-fit-pending");
            classify(p, img);
          });
        }
        return;
      }
      classify(p, img);
    });
  }

  function classify(p, img) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    if (!w || !h) return;
    // Only widen genuinely panoramic figures; a 1.2 aspect chart is better
    // served by the measure.
    if (w / h >= 2) {
      p.classList.add("figure-wide");
    } else {
      p.classList.remove("figure-wide");
    }
  }

  function filterToc() {
    var links = document.querySelectorAll(".toc-content a");
    links.forEach(function (a) {
      var text = (a.textContent || "").trim();
      if (TOC_NOISE.indexOf(text) !== -1) {
        var li = a.closest("li");
        if (li) li.style.display = "none";
      }
    });
  }

  // Wrap the leading emoji of a blockquote's first paragraph so CSS can see it.
  // Operates on text nodes only: the emoji is always a bare text node before
  // the <strong> that follows it, so no element is touched.
  function tagCallouts() {
    var quotes = document.querySelectorAll(".center > article blockquote");
    quotes.forEach(function (bq) {
      if (bq.dataset.calloutTagged) return;
      var p = bq.querySelector("p");
      if (!p || !p.firstChild || p.firstChild.nodeType !== Node.TEXT_NODE) return;
      var text = p.firstChild.textContent;
      for (var i = 0; i < CALLOUT_MARKERS.length; i++) {
        var m = CALLOUT_MARKERS[i];
        if (text.indexOf(m.emoji) === 0) {
          var span = document.createElement("span");
          span.className = "callout-lead " + m.cls;
          span.textContent = m.emoji;
          // Split the text node: emoji goes in the span, the rest stays put.
          p.firstChild.textContent = text.slice(m.emoji.length);
          p.insertBefore(span, p.firstChild);
          bq.dataset.calloutTagged = "1";
          return;
        }
      }
    });
  }

  function run() {
    fitFigures();
    filterToc();
    tagCallouts();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
  document.addEventListener("nav", run);
  window.addCleanup(function () {
    document.removeEventListener("nav", run);
  });
})();
`

const ReadingFit: QuartzTransformerPlugin = () => ({
  name: "ReadingFit",
  // The transformer pipeline requires at least one transform hook; this plugin
  // transforms nothing (it only ships a script), so pass the source through.
  textTransform(_ctx, src) {
    return src
  },
  externalResources() {
    return {
      css: [],
      js: [
        {
          script: FIGURE_AND_TOC_SCRIPT,
          loadTime: "afterDOMReady",
          contentType: "inline",
        },
      ],
    }
  },
})

export default ReadingFit
