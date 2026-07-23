const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

/**
 * Copy mtparser wasm assets into out/, patching bg.js to remove its
 * `import * as wasm from "./x.wasm"` line. That import relies on Node's
 * experimental wasm-module support, which the VS Code extension host does
 * not enable. We instantiate the wasm manually at runtime instead.
 */
function copyMtparserAssets() {
  return {
    name: "copy-mtparser-assets",
    setup(build) {
      build.onEnd(() => {
        const pkgRoot = path.dirname(
          require.resolve("@shapled/mtparser/package.json")
        );
        const outDir = path.join(__dirname, "out");

        // Patch bg.js: strip the static wasm import so it loads cleanly.
        const bgSrc = path.join(pkgRoot, "mtparser_wasm_bg.js");
        let bgContent = fs.readFileSync(bgSrc, "utf-8");
        bgContent = bgContent.replace(
          /^\s*import\s+\*\s+as\s+\w+\s+from\s+["']\.\/mtparser_wasm_bg\.wasm["'];?\s*$/m,
          ""
        );
        fs.writeFileSync(
          path.join(outDir, "mtparser_wasm_bg.js"),
          bgContent
        );

        // Copy wasm binary verbatim.
        fs.copyFileSync(
          path.join(pkgRoot, "mtparser_wasm_bg.wasm"),
          path.join(outDir, "mtparser_wasm_bg.wasm")
        );
      });
    },
  };
}

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
    plugins: [copyMtparserAssets()],
  })
  .catch(() => process.exit(1));
