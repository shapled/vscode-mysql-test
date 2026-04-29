import * as vscode from "vscode";
import {
  MtrDefinitionProvider,
  registerPairFileFeatures,
} from "./features/definition";
import { MtrDocumentLinkProvider } from "./features/document-link";
import { MtrHoverProvider } from "./features/hover";
import { MtrDocumentHighlightProvider } from "./features/highlight";
import { MtrReferenceProvider } from "./features/references";
import { activateTesting } from "./testing/test-controller";
import { getOutputChannel } from "./testing/output-channel";
import { initOutputChannel } from "./testing/output-channel";
import { activateTreeView } from "./testing/tree-view";

export function activate(context: vscode.ExtensionContext) {
  // Initialize shared output channel
  initOutputChannel(context);

  // Register testing (creates TestController)
  activateTesting(context);

  // Register Tree View panel
  activateTreeView(context);

  // Global error handler — log full stack traces to Output channel
  const outputChannel = getOutputChannel();

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

  registerPairFileFeatures(context);
}

export function deactivate() {}
