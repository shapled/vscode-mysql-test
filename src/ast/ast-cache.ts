import * as vscode from "vscode";
import type { Statement } from "@shapled/mtparser";
import { initWasm, parseMt } from "../wasm/wasm-loader";

/**
 * Per-document AST cache.
 *
 * The mtparser WASM module parses the full file each time; results are cached
 * keyed by (uri, version) so providers don't re-parse on every keystroke.
 * The cache invalidates automatically on document change/close.
 */
class AstCacheService {
  private cache = new Map<
    string,
    { version: number; promise: Promise<Statement[]> }
  >();

  private initialized = false;

  /** Ensure WASM is loaded. Safe to call repeatedly. */
  async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await initWasm();
      this.initialized = true;
    }
  }

  /** Get the parsed AST for a document, parsing if necessary. */
  async get(document: vscode.TextDocument): Promise<Statement[]> {
    const key = document.uri.toString();
    const version = document.version;
    const hit = this.cache.get(key);

    if (hit && hit.version === version) {
      return hit.promise;
    }

    const promise = (async () => {
      await this.ensureInitialized();
      return parseMt(document.getText(), undefined);
    })();

    this.cache.set(key, { version, promise });
    return promise;
  }

  /** Invalidate a single document's cache. */
  invalidate(uri: vscode.Uri): void {
    this.cache.delete(uri.toString());
  }

  /** Attach document lifecycle listeners. Call once at activation. */
  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        this.cache.delete(e.document.uri.toString());
      })
    );
    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.cache.delete(doc.uri.toString());
      })
    );
    context.subscriptions.push(
      vscode.workspace.onDidRenameFiles((e) => {
        for (const { oldUri } of e.files) {
          this.cache.delete(oldUri.toString());
        }
      })
    );
  }
}

/** Global singleton. */
export const astCache = new AstCacheService();
