import * as path from "path";
import * as fs from "fs";
import type { Statement } from "@shapled/mtparser";

/**
 * Loader for the @shapled/mtparser WASM module.
 *
 * The package's entrypoint uses `import * as wasm from "./x.wasm"`, which
 * requires Node's experimental wasm-module support. The VS Code extension
 * host does not enable that flag, so synchronous import fails.
 *
 * Instead we:
 *   1. Load the patched bg.js (esbuild strips its wasm import) via dynamic
 *      import — the file sits next to the bundled extension.js.
 *   2. Read the .wasm bytes from disk and instantiate via
 *      WebAssembly.instantiate (standard API, works everywhere).
 *   3. Inject the wasm exports into bg via __wbg_set_wasm.
 *
 * After `initWasm()` resolves, `parseMt` is safe to call.
 */

type ParseMtFn = (input: string, version?: string | null) => Statement[];

type BgModule = Record<string, unknown> & {
  __wbg_set_wasm: (val: unknown) => void;
  parse_mt: ParseMtFn;
};

let parseMtFn: ParseMtFn | undefined;
let initPromise: Promise<void> | null = null;

/** Load the mtparser module. Safe to call repeatedly. */
export function initWasm(): Promise<void> {
  if (!initPromise) {
    initPromise = doInit().catch((err) => {
      initPromise = null; // allow retry on failure
      throw err;
    });
  }
  return initPromise;
}

async function doInit(): Promise<void> {
  const dir = findOutDir();
  const bgPath = path.join(dir, "mtparser_wasm_bg.js");
  const wasmPath = path.join(dir, "mtparser_wasm_bg.wasm");

  if (!fs.existsSync(bgPath) || !fs.existsSync(wasmPath)) {
    throw new Error(
      `mtparser assets missing. Looked for:\n  ${bgPath}\n  ${wasmPath}`
    );
  }

  // Dynamic import with a runtime path so esbuild leaves it alone.
  const bgUrl = pathToFileUrl(bgPath);
  const bg = (await import(bgUrl)) as BgModule;

  const bytes = fs.readFileSync(wasmPath);

  // wasm-bindgen imports live under the "./mtparser_wasm_bg.js" module name.
  const importObject = {
    "./mtparser_wasm_bg.js": collectWasmImports(bg),
  } as unknown as WebAssembly.Imports;

  const { instance } = await WebAssembly.instantiate(bytes, importObject);
  bg.__wbg_set_wasm(instance.exports);

  const start = (instance.exports as Record<string, unknown>).__wbindgen_start;
  if (typeof start === "function") {
    (start as () => void)();
  }

  parseMtFn = bg.parse_mt;
}

/** Locate the directory holding the bundled assets. */
function findOutDir(): string {
  // Bundled (out/extension.js): __dirname is out/.
  // Vitest source mode: fall back to cwd-based candidates.
  const candidates = [
    __dirname,
    path.join(process.cwd(), "out"),
    process.cwd(),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "mtparser_wasm_bg.wasm"))) {
      return c;
    }
  }
  return __dirname;
}

function collectWasmImports(bg: Record<string, unknown>): Record<string, unknown> {
  const imports: Record<string, unknown> = {};
  for (const key of Object.keys(bg)) {
    if (key.startsWith("__wbg_") || key.startsWith("__wbindgen_")) {
      imports[key] = bg[key];
    }
  }
  return imports;
}

/** Convert a filesystem path to a file:// URL (works in both CJS and ESM). */
function pathToFileUrl(p: string): string {
  // Node 18+ supports pathToFileURL. Using URL form avoids Windows path issues.
  const { pathToFileURL } = require("url") as typeof import("url");
  return pathToFileURL(p).href;
}

/** Parse a mysqltest/mariadb-test file. Throws if not initialized. */
export function parseMt(
  input: string,
  version?: string
): Statement[] {
  if (!parseMtFn) {
    throw new Error("mtparser not initialized — call initWasm() first");
  }
  return parseMtFn(input, version);
}
