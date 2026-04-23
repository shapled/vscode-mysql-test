const esbuild = require("esbuild");

const production = process.argv.includes("--production");

esbuild
  .build({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    mainFields: ["module", "main"],
    treeShaking: true,
    platform: "node",
    outfile: "out/extension.js",
    external: ["vscode"],
  })
  .catch(() => process.exit(1));
