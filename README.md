<p align="center">
  <img src="icon.png" alt="MySQL Test Logo" width="128">
</p>

[![GitHub](https://img.shields.io/badge/GitHub-shapled%2Fvscode--mysql--test-181717?logo=github)](https://github.com/shapled/vscode-mysql-test) [![Install](https://img.shields.io/badge/Install-VS_Code_Marketplace-blue?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=Shapled.mysql-test)

## Features

Syntax highlighting and navigation for MySQL test files (`.test`, `.result`, `.opt`, `.cnf`).

### Syntax Highlighting

Provides TextMate-based syntax highlighting for MySQL test framework files:

| File Type | Scope           | Highlights                                                                                                                                |
| --------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `.test`   | Test cases      | MTR directives (`--source`, `--let`, `--echo`, `--error`, etc.), SQL keywords, strings, variables (`$var`), control flow (`if/then/else`) |
| `.result` | Expected output | MTR directives, result set column headers, `NULL`, `Warning`, `ERROR`                                                                     |
| `.opt`    | Server options  | `--key=value` options, `$VARIABLE` environment references                                                                                 |
| `.cnf`    | Server config   | INI sections, key-value pairs, `!include` directives                                                                                      |
| `.inc`    | Include files   | Same as `.test` (MTR DSL + SQL)                                                                                                           |

Files are automatically recognized when located under a `mysql-test/` directory tree (e.g. `mysql-test/t/`, `mysql-test/suite/innodb/t/`).

### Navigation

- **Go to Paired File** — Click the CodeLens link at the top of each file to jump to related files:
  - `.test` → shows links to `.result`, `.opt`, `.cnf` (if they exist)
  - `.result` / `.opt` / `.cnf` → shows link back to `.test`
- **Alt+O** — Keyboard shortcut to jump between `.test` and `.result` files
- **Go to Definition** — Ctrl+Click on `--source` / `--include` paths to jump to `.inc` files
- **Variable Jump** — Ctrl+Click on `$variable` to jump to its `--let` declaration

## Requirements

- VS Code 1.85.0 or later

## Extension Settings

This extension does not add any settings.

## Known Issues

None.

## Release Notes

### 1.0.2

- Expand VS Code compatibility to 1.85.0+
- Fix relative path resolution for `--source ../include/xxx.inc`

### 1.0.1

Initial release:

- Syntax highlighting for `.test`, `.result`, `.opt`, `.cnf`, `.inc` files
- CodeLens links for paired file navigation
- Alt+O shortcut for test/result switching
- Go to Definition for `--source`/`--include` and MTR variables
