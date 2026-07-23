import * as vscode from "vscode";
import {
  MtrDefinitionProvider,
  registerPairFileFeatures,
} from "./features/definition";
import { MtrDocumentLinkProvider } from "./features/document-link";
import { MtrHoverProvider } from "./features/hover";
import { MtrDocumentHighlightProvider } from "./features/highlight";
import { MtrReferenceProvider } from "./features/references";
import { MtrCompletionProvider } from "./features/completion";
import {
  MtrSemanticTokensProvider,
  legend,
} from "./features/semantic-tokens";
import { activateTesting } from "./testing/test-controller";
import { getOutputChannel } from "./testing/output-channel";
import { initOutputChannel } from "./testing/output-channel";
import { activateTreeView } from "./testing/tree-view";
import { astCache } from "./ast/ast-cache";
import { initWasm, parseMt } from "./wasm/wasm-loader";

export async function activate(context: vscode.ExtensionContext) {
  // Initialize shared output channel
  initOutputChannel(context);

  // ── WASM parser (mtparser) ───────────────────────────────
  // Pre-load eagerly so providers don't block on first use.
  const outputChannel = getOutputChannel();
  astCache.register(context);
  void initWasm()
    .then(() => {
      const sample = "--source include/have_debug.inc\n--let $x = 1\n";
      const ast = parseMt(sample, "8.0");
      outputChannel.appendLine(
        `[mtparser] WASM loaded OK; sample parse returned ${ast.length} statements`
      );
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      outputChannel.appendLine(`[mtparser] WASM load FAILED: ${msg}`);
      outputChannel.show(true);
    });

  // Register testing (creates TestController)
  activateTesting(context);

  // Register Tree View panel
  activateTreeView(context);

  const logError = (label: string, err: unknown) => {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    // Only log errors from our extension, skip other extensions' noise
    if (typeof msg === "string" && !msg.includes("mysql-test") && !msg.includes("MTR")) {
      return;
    }
    outputChannel.appendLine(`[${label}] ${msg}`);
    outputChannel.show(true);
  };

  process.on("uncaughtException", (err) => logError("uncaughtException", err));
  process.on("unhandledRejection", (reason) => logError("unhandledRejection", reason));

  const selector: vscode.DocumentSelector = [
    { language: "mysql-test" },
    { language: "mysql-result" },
    { language: "mysql-opt" },
    { language: "mysql-cnf" },
  ];

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      selector,
      new MtrDefinitionProvider()
    )
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      selector,
      new MtrHoverProvider()
    )
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentHighlightProvider(
      selector,
      new MtrDocumentHighlightProvider()
    )
  );

  context.subscriptions.push(
    vscode.languages.registerReferenceProvider(
      selector,
      new MtrReferenceProvider()
    )
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(
      selector,
      new MtrDocumentLinkProvider()
    )
  );

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      new MtrCompletionProvider(),
      "/",
      "$",
      "."
    )
  );

  // AST-driven syntax highlighting via Semantic Tokens.
  // Uses standard token types so the active theme controls colours.
  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      selector,
      new MtrSemanticTokensProvider(),
      legend
    )
  );

  registerPairFileFeatures(context);
}

export function deactivate() {}
