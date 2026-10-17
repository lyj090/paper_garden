/**
 * Sort the complete literature list. Text lookup belongs to the browser's Find
 * command, so every paper stays visible and old ?q= links cannot hide results.
 * The ?sort= parameter preserves the selected order across reloads and history.
 */

export interface LitFilterState {
  sort: string
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
    if (s.sort !== DEFAULT_SORT) p.set("sort", s.sort)
    return p
  }

  function stateFromSearch(search) {
    var p = new URLSearchParams(search)
    var sort = p.get("sort")
    return {
      sort: sort ? sort : DEFAULT_SORT,
    }
  }

  function sameState(a, b) {
    return a.sort === b.sort
  }

  function create(dom, initial) {
    var state = {
      sort: initial.sort || DEFAULT_SORT,
    }
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
        if (push) history.pushState(history.state, "", url)
        else history.replaceState(history.state, "", url)
      } catch (e) { /* history unavailable */ }
    }

    function isDefaultView() {
      return state.sort === DEFAULT_SORT
    }

    function apply() {
      var visible = dom.cards.slice()

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
          items.forEach(function (item) {
            var stamp = item.querySelector(".lit-added")
            if (stamp) stamp.remove()
            ul.appendChild(item)
          })
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

    function setState(next) {
      Object.assign(state, next)
      apply()
      syncUrl(true)
    }

    // -- events ---------------------------------------------------------------
    function onChange(e) {
      var t = e.target
      if (t.matches && t.matches("[data-sort-select]")) setState({ sort: t.value })
    }
    function onPopState() {
      // The SPA router handles navigation between pages.
      if (!dom.root.isConnected) return
      var next = stateFromSearch(location.search)
      if (sameState(state, next)) return
      suppressSync = true
      state = next
      if (dom.sortSelect) dom.sortSelect.value = state.sort
      apply()
      suppressSync = false
    }
    dom.root.addEventListener("change", onChange)
    window.addEventListener("popstate", onPopState)
    if (dom.sortSelect) dom.sortSelect.value = state.sort

    apply()
    syncUrl(false)

    return function () {
      dom.root.removeEventListener("change", onChange)
      window.removeEventListener("popstate", onPopState)
    }
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
  countEl: HTMLElement | null
  sortSelect: HTMLSelectElement | null
}

export function stateFromSearch(search: string): LitFilterState {
  const p = new URLSearchParams(search)
  return {
    sort: p.get("sort") || DEFAULT_SORT,
  }
}

export function create(dom: LitFilterDom, initial: LitFilterState): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const LF = (window as any).LitFilter
  if (LF) LF.create(dom, initial)
}
