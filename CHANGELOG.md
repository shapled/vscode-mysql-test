## [2.0.0]

### Parser Engine Replacement (mtparser 0.4, breaking)

- Replace the Rust/WASM **@shapled/mtparser** 0.3.x with the Gleam-compiled pure-JS **0.4.1** — no WASM binary, no async initialization, no experimental Node flags
- Remove the `wasm-loader` runtime patching entirely; the parser is bundled by esbuild as a regular dependency (VSIX shrinks ~90 KB, ships no `node_modules`)
- Adapt all AST consumers to the new class-based AST: `DashCommand` wrapper for `--` prefixed commands, `Marker` end markers, `LetValue` variants (`Text`/`QueryValue`/`QueryGetValue`/`Escape`/`ConvertError`)
- Span units are now **UTF-16 code units** (was UTF-8 bytes in 0.3.x) — token positions are correct in files containing non-ASCII text (validated over 20k+ real MySQL/MariaDB test files)
- Parse failures degrade gracefully: references lookup skips broken include files instead of failing the whole request

### Semantic Highlighting

- `escape()`/`convert_error()` let values: function name, the **real** opening/closing parens, and argument tokens — the parser resolves which `)` is a character argument (e.g. `escape(), hihi (haha))`), which regexes cannot
- `$var` references inside backtick query values (`--let $x= \`select $a-$b\``) highlighted with exact spans
- `--let`/`--inc`/`--dec`/`--expr` variables use exact `variable_span` tokens instead of text re-scanning
- `--` prefix token uses the AST's exact dash span; `write_file`/`append_file` content regions derived from marker spans

### Bracket Pairing Fix

- `escape(...)` argument regions carry `meta.escape.arguments` and are excluded from bracket pairing via `unbalancedBracketScopes` — the `(` now pairs with the final `)` instead of the first character-argument `)`; SQL bracket pairing is unaffected

### Navigation

- Variable declarations, references, and `--source` includes **inside `if`/`while` blocks** are now found (recursive AST walk) — `if($ts_flag)` jumps to a `--let` declared in the same block
- Cursor resolution prefers the innermost statement, so Go-to-Definition works on `--source` lines nested in blocks
- Variable occurrences no longer double-count inside blocks (block headers and bodies are scanned disjointly)
- Go-to-Definition for `--let` targets the exact `$name` token (env-style declarations without `$` supported)
- File-path links use exact `TextPart` spans — `--chmod 0644 file` now links the file, not the mode

### Fixes

- **Sync and Run Test / Run & Record / Debug** pre-sync copied files to `<installDir>/suite/...` instead of `<installDir>/mysql-test/suite/...` (the `mysql-test` path segment was dropped; the sync log printed the correct target, masking the bug)
- Relative-path computation mixed symlink-resolved roots with unresolved source paths — paths through symlinks now sync correctly
- Removed unused `syncTestFile` import from the tree view

## [1.2.0]

### Structured AST Parsing (mtparser)

- Replace regex-based parsing with **@shapled/mtparser** WASM parser for all language features
- Parse `.test`/`.inc` files into a typed AST with source location spans for every token
- Multi-line constructs correctly recognized: `write_file`/`append_file` blocks, `perl` blocks (with heredoc `END` markers), multi-line `echo`, multi-line `let` with backtick SQL

### Semantic Syntax Highlighting

- Add **Semantic Tokens** provider for AST-driven syntax highlighting (command keywords, `$variables`, strings, comments, operators, block braces, end markers)
- Colors follow the active theme via standard token types — no hard-coded hex values
- Auto-enable `editor.semanticHighlighting.enabled` for `mysql-test` language via `configurationDefaults`
- Recursive token extraction into `if`/`while` block bodies

### TextMate Grammar Improvements

- Non-prefix commands (`let`/`echo`/`die`/`exec`/file-path commands) now use `;\s*$` as end pattern, preventing multi-line content from leaking into SQL scope
- `#sql` rules use `source.sql` (VS Code built-in SQL grammar) + MySQL-specific keyword supplement (`FLUSH`/`SHOW`/`RESET`/etc.)
- `#strings` simplified: removed cross-line single/double quote rules (only backtick SQL remains)
- `#comments` use `begin/end` with `name` to ensure the `#` character gets the comment scope
- `perl` block content delegates to `source.perl` (VS Code built-in Perl grammar)

### Hover Documentation

- Merge command docs from `mtlang-wrapper` skill (`assets/commands.json`) with hand-curated `mtr-commands.json`
- Add built-in variable documentation (`assets/variables.json`)
- Hover `$MYSQL_TMP_DIR` etc. to see variable descriptions

### Other Improvements

- AST-based `query_get_value` function parsing: function name, parentheses, commas, and arguments each have precise spans
- `end_marker` spans for `write_file`/`append_file`/`perl` blocks (open + close markers)
- `open_brace_span`/`close_brace_span` for `if`/`while` blocks
- WASM loaded via standard `WebAssembly.instantiate` (no dependency on Node experimental wasm-modules flag)
- Dynamic color theme switching (`onDidChangeActiveColorTheme`) with dark/light/high-contrast palettes

## [1.1.1]

- Fix `--source`/`--include` path resolution incorrectly appending `.inc` to paths that already have an extension (e.g. `--source ./file.test` was resolved to `file.test.inc`)
- Add **path autocompletion** for `--source`/`--include` commands — lists matching files and directories based on partial path input, supports relative paths (`./`, `../`), mysql-test root-relative paths, and absolute paths

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
