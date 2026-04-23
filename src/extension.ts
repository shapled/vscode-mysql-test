import * as vscode from "vscode";
import {
  MtrDefinitionProvider,
  registerPairFileFeatures,
} from "./features/definition";
import { MtrHoverProvider } from "./features/hover";

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

  registerPairFileFeatures(context);
}

export function deactivate() {}
