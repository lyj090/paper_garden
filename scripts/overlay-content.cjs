#!/usr/bin/env node
/**
 * overlay-content — copy `content-extras/` over `content/`.
 *
 * SAFETY: in CI, `content/` is a throwaway `git clone` of the vault, so
 * overwriting is fine. LOCALLY, `content` is usually a symlink to the real
 * Obsidian vault — writing through it silently clobbers your own notes
 * (this happened to `index.md` and `02-Literature/index.md`).
 *
 * Therefore: if `content` is a symlink, do NOT write. Either skip with a
 * notice, or write to a staging dir instead. Set
 * `OVERLAY_ALLOW_SYMLINK=1` to force the old behaviour.
 */
const fs = require("fs")
const path = require("path")

const SRC = "content-extras"
const DST = "content"
const FORCE = process.env.OVERLAY_ALLOW_SYMLINK === "1"

function cp(src, dst) {
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dst, { recursive: true })
    for (const e of fs.readdirSync(src)) cp(path.join(src, e), path.join(dst, e))
  } else {
    fs.copyFileSync(src, dst)
  }
}

function isSymlink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

if (!fs.existsSync(SRC)) {
  console.log(`overlay-content: no ${SRC}/, skipping`)
  process.exit(0)
}

if (isSymlink(DST) && !FORCE) {
  const target = fs.readlinkSync(DST)
  console.log(
    [
      `overlay-content: SKIPPED — "${DST}" is a symlink to ${target}`,
      "",
      "  Writing here would overwrite files in your real vault",
      "  (index.md, 02-Literature/index.md).",
      "",
      "  CI clones the vault, so the overlay applies there automatically.",
      "  To build locally with the overlay applied, point `content` at a copy:",
      "",
      "      rm content && git clone --depth 1 <vault> content",
      "      # or: cp -rL <vault> content",
      "",
      "  To force the legacy behaviour anyway:",
      "      OVERLAY_ALLOW_SYMLINK=1 npm run overlay-content",
      "",
    ].join("\n"),
  )
  process.exit(0)
}

cp(SRC, DST)
console.log(`overlay-content: copied ${SRC}/ -> ${DST}/`)
