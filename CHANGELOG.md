## [1.1.0]

### Test Execution

- Add **Run Test** CodeLens button on `.test` files — click or press **F5** to run the current test via MTR
- Add **Run & Record** command — runs tests with `--record` flag and syncs updated `.result` files back to source
- Add `mysql-test.mtrArgs` setting (default: `--force --retry=0`) for configuring MTR arguments
- Auto-sync test files from source tree to install directory before running
- Show real-time MTR output in a log file tab during test execution

### Tree View Panels

- Add **Configuration** panel — displays all extension settings with status indicators; click to open `settings.json` with auto-created defaults
- Add **MySQL Test Run** panel with three groups:
  - **Opened Test Cases** — lists all open `.test` file tabs, click to navigate
  - **Actions** — Sync and Run Test, Run & Record, Incremental Build, Full Rebuild, Sync Suite
  - **History** — shows last 20 test runs with status, duration, and time ago
- Grey out unavailable actions with reason descriptions (no installDir / no test file selected)

### Build Integration

- Add **Incremental Build** and **Full Rebuild** commands, configurable via `buildCommand` / `rebuildCommand` settings
- Add **Sync Suite** command — deletes and re-copies the entire test suite from source to install directory

### Other

- Rename `baseDir` setting to `installDir` throughout the extension
- Move Run Test CodeLens before paired file links for better visibility
- Add unit tests for tree view panel logic

## [1.0.4]

- Add `perl`/`--perl` block syntax highlighting with built-in Perl keywords, functions, variables, operators, and strings
- Add file path link highlighting for `source`, `write_file`, `append_file`, `cat_file`, `mkdir`, etc. with Ctrl+Click navigation
- Add document link provider for path commands to navigate to existing files on disk
- Treat `die`/`--die` content as raw string (variables are not expanded or highlighted)
- Treat `echo`/`--echo` content as unquoted string
- Add backtick string highlighting with embedded SQL for `let $q = \`SELECT ...\``
- Fix variable jump when `$variable` is adjacent to other characters (e.g. `d$i.t1`)

## [1.0.3]

- Add hover documentation for 90+ MTR commands with syntax, description, examples, and links to official docs
- Recognize MTR commands without `--` prefix (semicolon-terminated), properly separate them from SQL highlighting
- Fix CodeLens and file pairing on Windows (backslash paths and WSL paths)

## [1.0.2]

- Expand VS Code compatibility to 1.85.0+
- Fix relative path resolution for `--source ../include/xxx.inc`

## [1.0.1]

Initial release:

- Syntax highlighting for `.test`, `.result`, `.opt`, `.cnf`, `.inc` files
- CodeLens links for paired file navigation
- Alt+O shortcut for test/result switching
- Go to Definition for `--source`/`--include` and MTR variables
