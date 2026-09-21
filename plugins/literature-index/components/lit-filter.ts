/**
 * LitFilter — the single source of truth for client-side filtering / sorting
 * of the literature cards.
 *
 * Two faces:
 *  1. LIT_FILTER_SCRIPT (string): a self-contained browser script defining
 *     window.LitFilter. Shipped verbatim via the page body's afterDOMLoaded —
 *     no extra HTTP request, no build step.
 *  2. create(...) (TS): the same controller behind that script, used by the
 *     bootstrap string in index.ts.
 *
 * Features (browser side):
 *  - URL state sync (?q=&tag=&src=&sort=) → shareable, bookmarkable
 *  - popstate handling → browser back/forward restores filters without reload
 *  - stacked AND tag filters with chip UI and pill highlighting
 *  - grouped default view vs flat sorted view
 */

export interface LitFilterState {
  query: string
  tagList: string[]
  source: "all" | "paper" | "clip"
  sort: string
  /** tag pages: the page's own tag, baked into the SSR list — never a filter */
  lockedTag?: string
}

export const DEFAULT_SORT = "added-desc"

/* ---------------------------------------------------------------------------
 * Browser script (kept as a plain string so it ships inside the page body
 * without any additional request or bundler step).
 * ------------------------------------------------------------------------- */
export const LIT_FILTER_SCRIPT = `
window.LitFilter = (function () {
  var DEFAULT_SORT = "added-desc"

  function stateToParams(s) {
    var p = new URLSearchParams()
    if (s.query) p.set("q", s.query)
    if (s.tagList.length > 0) p.set("tag", s.tagList.join(","))
    if (s.source !== "all") p.set("src", s.source)
    if (s.sort !== DEFAULT_SORT) p.set("sort", s.sort)
    return p
  }

  function stateFromSearch(search) {
    var p = new URLSearchParams(search)
    var src = p.get("src")
    var sort = p.get("sort")
    return {
      query: p.get("q") || "",
      tagList: p.get("tag") ? p.get("tag").split(",").filter(Boolean) : [],
      source: src === "paper" || src === "clip" ? src : "all",
      sort: sort ? sort : DEFAULT_SORT,
    }
  }

  function sameState(a, b) {
    return a.query === b.query && a.source === b.source && a.sort === b.sort &&
      a.tagList.length === b.tagList.length &&
      a.tagList.every(function (t, i) { return t === b.tagList[i] })
  }

  function create(dom, initial) {
    var state = {
      query: initial.query || "",
      tagList: (initial.tagList || []).filter(function (t) {
        return !initial.lockedTag || t.toLowerCase() !== String(initial.lockedTag).toLowerCase()
      }),
      source: initial.source || "all",
      sort: initial.sort || DEFAULT_SORT,
    }
    // On tag pages the page's own tag is baked into the SSR'd card list; it is
    // locked context, never a client-side filter, so the URL stays clean.
    var lockedTag = initial.lockedTag || ""
    var suppressSync = false

    function fmtDate(ts) {
      return new Date(ts).toLocaleDateString("zh-CN", { year: "numeric", month: "short" })
    }

    function syncUrl(push) {
      if (suppressSync) return
      var params = stateToParams(state)
      var qs = params.toString()
      var url = location.pathname + (qs ? "?" + qs : "") + location.hash
      try {
        if (push) history.pushState({ litFilter: true }, "", url)
        else history.replaceState({ litFilter: true }, "", url)
      } catch (e) { /* history unavailable */ }
    }

    function isDefaultView() {
      return state.sort === DEFAULT_SORT && state.source === "all" &&
        !state.query && state.tagList.length === 0
    }

    function apply() {
      renderChips()
      renderPillHighlights()

      var activeTags = state.tagList.map(function (t) { return t.toLowerCase() })
      var q = state.query.toLowerCase()
      var visible = dom.cards.filter(function (item) {
        var card = item.querySelector(".lit-card")
        if (!card) return false
        var src = card.getAttribute("data-source")
        if (state.source === "paper" && src !== "paper") return false
        if (state.source === "clip" && src !== "clip") return false
        if (activeTags.length > 0) {
          var tags = (card.getAttribute("data-tags") || "").toLowerCase().split("|")
          for (var i = 0; i < activeTags.length; i++) {
            if (tags.indexOf(activeTags[i]) === -1) return false
          }
        }
        if (q) {
          var hay = (card.getAttribute("data-search") || "").toLowerCase()
          if (hay.indexOf(q) === -1) return false
        }
        return true
      })

      var cmp = {
        "added-desc": function (a, b) { return num(b, "data-added") - num(a, "data-added") || byTitle(a, b) },
        "added-asc": function (a, b) { return num(a, "data-added") - num(b, "data-added") || byTitle(a, b) },
        "year-desc": function (a, b) { return num(b, "data-year") - num(a, "data-year") || byTitle(a, b) },
        "year-asc": function (a, b) { return num(a, "data-year") - num(b, "data-year") || byTitle(a, b) },
        "title-asc": byTitle,
        "title-desc": function (a, b) { return -byTitle(a, b) },
      }[state.sort] || byTitle
      function byTitle(a, b) {
        return a.querySelector(".lit-card").getAttribute("data-title").localeCompare(
          b.querySelector(".lit-card").getAttribute("data-title"))
      }
      function num(el, attr) {
        return parseInt(el.querySelector(".lit-card").getAttribute(attr) || "0", 10)
      }
      visible.sort(cmp)

      if (isDefaultView()) {
        var byGroup = new Map()
        visible.forEach(function (item) {
          var key = dom.groupOf.get(item) || "other"
          if (!byGroup.has(key)) byGroup.set(key, [])
          byGroup.get(key).push(item)
        })
        dom.groups.forEach(function (g) {
          var ul = g.querySelector(".lit-list")
          var items = byGroup.get(g.id) || []
          items.forEach(function (item) { ul.appendChild(item) })
          g.style.display = items.length > 0 ? "" : "none"
        })
        dom.flat.classList.add("lit-hidden")
      } else {
        dom.groups.forEach(function (g) { g.style.display = "none" })
        dom.flat.classList.remove("lit-hidden")
        visible.forEach(function (item) {
          var card = item.querySelector(".lit-card")
          var meta = card.querySelector(".lit-card-meta")
          var stamp = meta.querySelector(".lit-added")
          var added = parseInt(card.getAttribute("data-added") || "0", 10)
          if (!isNaN(added) && added > 0) {
            if (!stamp) {
              stamp = document.createElement("span")
              stamp.className = "lit-added"
              meta.appendChild(stamp)
            }
            stamp.textContent = "入库 " + fmtDate(added)
          }
          dom.flat.appendChild(item)
        })
      }

      if (dom.countEl) dom.countEl.textContent = String(visible.length)
    }

    function renderChips() {
      dom.chipBar.innerHTML = ""
      dom.chipBar.classList.toggle("lit-has-chips", state.tagList.length > 0)
      state.tagList.forEach(function (tag) {
        var chip = document.createElement("span")
        chip.className = "lit-chip"
        chip.textContent = tag
        var x = document.createElement("button")
        x.type = "button"
        x.className = "lit-chip-x"
        x.setAttribute("data-tag-remove", tag)
        x.setAttribute("aria-label", "移除筛选 " + tag)
        x.textContent = "×"
        chip.appendChild(x)
        dom.chipBar.appendChild(chip)
      })
    }

    function renderPillHighlights() {
      var active = state.tagList.map(function (t) { return t.toLowerCase() })
      dom.cards.forEach(function (item) {
        item.querySelectorAll("a.lit-tag").forEach(function (p) {
          var t = (p.getAttribute("data-tag") || "").toLowerCase()
          p.classList.toggle("lit-tag-active", active.indexOf(t) >= 0)
        })
      })
    }

    function toggleTag(tag) {
      if (!tag || tag.toLowerCase() === lockedTag.toLowerCase()) return
      var i = state.tagList.indexOf(tag)
      if (i >= 0) state.tagList.splice(i, 1)
      else state.tagList.push(tag)
      apply()
      syncUrl(true)
    }

    function setState(next) {
      Object.assign(state, next)
      apply()
      syncUrl(true)
    }

    // -- events ---------------------------------------------------------------
    // clicking a pill whose tag equals the locked own-tag is a no-op there
    dom.root.addEventListener("change", function (e) {
      var t = e.target
      if (t.matches("[data-sort-select]")) setState({ sort: t.value })
      else if (t.matches("[data-source-select]")) setState({ source: t.value })
    })
    dom.root.addEventListener("input", function (e) {
      var t = e.target
      if (t.matches("[data-search-input]")) {
        state.query = t.value.trim()
        apply()
        syncUrl(false) // typing replaces, never pushes
      }
    })
    dom.root.addEventListener("click", function (e) {
      var t = e.target
      var pill = t.closest ? t.closest("a.lit-tag[data-tag]") : null
      if (pill) {
        e.preventDefault()
        toggleTag(pill.getAttribute("data-tag"))
        return
      }
      if (t.matches("[data-tag-remove]")) {
        e.preventDefault()
        toggleTag(t.getAttribute("data-tag-remove"))
      }
    })
    window.addEventListener("popstate", function () {
      var next = stateFromSearch(location.search)
      if (lockedTag) {
        // the own-tag never lives in the URL; ignore stale ?tag= it from
        // older shared links so back/forward always keeps the page's context
        next.tagList = next.tagList.filter(function (t) {
          return t.toLowerCase() !== lockedTag.toLowerCase()
        })
      }
      if (sameState(state, next)) return
      suppressSync = true
      state = next
      if (dom.searchInput) dom.searchInput.value = state.query
      if (dom.sortSelect) dom.sortSelect.value = state.sort
      if (dom.sourceSelect) dom.sourceSelect.value = state.source
      apply()
      suppressSync = false
    })

    apply()
    syncUrl(false)

    return { toggleTag: toggleTag, setState: setState, apply: apply }
  }

  return { create: create, stateFromSearch: stateFromSearch }
})();
`

/* ------------------------------ typed facade ------------------------------ */

export interface LitFilterDom {
  root: HTMLElement
  cards: HTMLElement[]
  flat: HTMLElement
  groups: HTMLElement[]
  groupOf: Map<HTMLElement, string>
  chipBar: HTMLElement
  countEl: HTMLElement | null
  searchInput: HTMLInputElement | null
  sortSelect: HTMLSelectElement | null
  sourceSelect: HTMLSelectElement | null
}

export function stateFromSearch(search: string): LitFilterState {
  const p = new URLSearchParams(search)
  const src = p.get("src")
  return {
    query: p.get("q") ?? "",
    tagList: p.get("tag") ? p.get("tag")!.split(",").filter(Boolean) : [],
    source: src === "paper" || src === "clip" ? src : "all",
    sort: p.get("sort") || DEFAULT_SORT,
  }
}

export function create(dom: LitFilterDom, initial: LitFilterState): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const LF = (window as any).LitFilter
  if (LF) LF.create(dom, initial)
}
