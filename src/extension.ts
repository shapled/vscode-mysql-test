import * as vscode from "vscode";
import {
  MtrDefinitionProvider,
  registerPairFileFeatures,
} from "./features/definition";
import { MtrDocumentLinkProvider } from "./features/document-link";
import { MtrHoverProvider } from "./features/hover";
import { MtrDocumentHighlightProvider } from "./features/highlight";
import { MtrReferenceProvider } from "./features/references";

export function activate(context: vscode.ExtensionContext) {
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
