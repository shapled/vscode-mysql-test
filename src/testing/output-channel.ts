import * as vscode from "vscode";

let outputChannel: vscode.OutputChannel;

export function initOutputChannel(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("MySQL Test");
  context.subscriptions.push(outputChannel);
}

export function getOutputChannel(): vscode.OutputChannel {
  return outputChannel;
}
