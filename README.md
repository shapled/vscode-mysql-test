<p align="center">
  <img src="icon.png" alt="MySQL Test Logo" width="128">
</p>

[![GitHub](https://img.shields.io/badge/GitHub-shapled%2Fvscode--mysql--test-181717?logo=github)](https://github.com/shapled/vscode-mysql-test) [![Install](https://img.shields.io/badge/Install-VS_Code_Marketplace-blue?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=Shapled.mysql-test)

## Features

- [Syntax Highlighting](#syntax-highlighting)
- [MTR Command Recognition](#mtr-command-recognition)
- [Variable Tracking](#variable-tracking)
- [Navigation](#navigation)
- [Hover Documentation](#hover-documentation)
- [Cross-Platform Support](#cross-platform-support)
- [Test Execution](#test-execution)
- [Build Integration](#build-integration)
- [Tree View Panels](#tree-view-panels)
- [Path Autocompletion](#path-autocompletion)

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

### MTR Command Recognition

MTR commands are recognized both with the `--` prefix (`--echo text`) and without (`echo text;`), so non-command lines are properly highlighted as SQL.

| Directive                                                         | Highlighting                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------- |
| `--eval` / `eval`                                                 | SQL keywords, variables, strings                              |
| `--echo` / `echo`                                                 | Entire content as unquoted string (variables are expanded)    |
| `--die` / `die`                                                   | Entire content as raw string (variables are NOT expanded)     |
| `--let` / `let`                                                   | Variable declaration, strings, backtick-embedded SQL          |
| `--perl` / `perl`                                                 | Perl block with built-in keywords, functions, variables, etc. |
| `--exec` / `exec`                                                 | Shell command content                                         |
| `--error`                                                         | Error code or variable                                        |
| Path commands (`source`, `write_file`, `cat_file`, `mkdir`, etc.) | File paths as clickable links                                 |

### Variable Tracking

Full variable lifecycle support for `$variable` references across MTR test files:

- **Go to Definition** — Ctrl+Click on `$variable` to jump to its `--let` declaration in the current file
- **Find All References** — Shift+F12 to find all usages of a variable across the current file and included `.inc` files (up to 16 levels deep)
- **Document Highlight** — Click on a variable to highlight all occurrences in the current file, with declarations shown in write style and usages in read style
- **Adjacent Variable Support** — Variables without preceding spaces (e.g. `d$i.t1`) are correctly recognized for navigation

Variables inside `die`/`--die` raw strings are excluded from tracking since they are not expanded.

### Navigation

- **Go to Paired File** — Click the CodeLens link at the top of each file to jump to related files:
  - `.test` → shows Run Test button first, then links to `.result`, `.opt`, `.cnf` (if they exist)
  - `.result` / `.opt` / `.cnf` → shows link back to `.test`
- **Alt+O** — Keyboard shortcut to jump between `.test` and `.result` files
- **File Path Navigation** — Ctrl+Click on file paths in path commands (`source`, `write_file`, `cat_file`, `mkdir`, etc.) to open the target file

### Hover Documentation

Hover over any MTR command to see its syntax, description, usage example, and a link to the official MySQL documentation.

### Cross-Platform Support

Works on Windows (including WSL paths), macOS, and Linux. File pairing and include path resolution handle both forward slashes and backslashes.

### Test Execution

Run MySQL test cases directly from VS Code using MTR (MySQL Test Run):

- **Run Test** — Click the CodeLens button at the top of any `.test` file, or press **F5**
- **Run & Record** — Runs with `--record` flag; after all tests pass, updated `.result` files are synced back to the source tree
- Tests are automatically synced from source to install directory before running
- Real-time MTR output is shown in a log file tab

### Build Integration

- **Incremental Build** and **Full Rebuild** commands, configurable via settings
- Build output is shown in the "MySQL Test" output channel

### Tree View Panels

The extension adds two panels in the sidebar:

**Configuration** — Displays all extension settings with status indicators. Click any setting to open `.vscode/settings.json` with auto-created default values.

**MySQL Test Run** — Contains three groups:

- **Opened Test Cases** — Lists all open `.test` file tabs; click to navigate
- **Actions** — Provides quick access to common operations:
  - Sync and Run Test / Run & Record
  - Incremental Build / Full Rebuild
  - Sync Suite (delete and re-copy entire suite from source)
- **History** — Shows the last 20 test runs with status, duration, and relative time

Unavailable actions are greyed out with a reason description (e.g. "installDir not configured", "no test file selected").

### Path Autocompletion

Autocompletion for file paths in `source` / `include` commands:

- Paths without `./` / `../` are resolved relative to the `mysql-test` root directory
- Paths with `./` / `../` are resolved relative to the current file's directory

## Requirements

- VS Code 1.85.0 or later

## Extension Settings

| Setting                     | Default             | Description                                                  |
| --------------------------- | ------------------- | ------------------------------------------------------------ |
| `mysql-test.installDir`     |                     | Path to the MySQL install directory containing `mysql-test/` |
| `mysql-test.buildDir`       |                     | Path to the build output directory                           |
| `mysql-test.buildCommand`   |                     | Incremental build command (executed in `buildDir`)           |
| `mysql-test.rebuildCommand` |                     | Full rebuild command (executed in `buildDir`)                |
| `mysql-test.autoSync`       | `true`              | Auto-sync test files before running                          |
| `mysql-test.debugAdapter`   | `auto`              | Debug adapter to use (`auto`, `lldb`, `cppdbg`)              |
| `mysql-test.mtrArgs`        | `--force --retry=0` | Arguments passed to MTR when running tests                   |

## Commands

| Command                       | Key   | Description                                       |
| ----------------------------- | ----- | ------------------------------------------------- |
| MySQL Test: Run Test          | F5    | Run the current `.test` file via MTR              |
| MySQL Test: Run & Record      |       | Run with `--record` and sync `.result` files back |
| MySQL Test: Incremental Build |       | Execute the incremental build command             |
| MySQL Test: Full Rebuild      |       | Execute the full rebuild command                  |
| MySQL Test: Sync Suite        |       | Delete and re-copy the current test suite         |
| MySQL Test: Refresh Tests     |       | Refresh the test discovery                        |
| MySQL Test: Go to Paired File | Alt+O | Jump to the paired `.test`/`.result` file         |

## Release Notes

See [CHANGELOG.md](CHANGELOG.md).
