import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "index.ts",
    "components/index": "components/LitIndexNav.ts",
  },
  format: ["esm"],
  target: "es2022",
  platform: "node",
})
