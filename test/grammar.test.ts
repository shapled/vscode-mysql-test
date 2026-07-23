import { describe, it, expect, beforeAll } from "vitest";
import * as vsctm from "vscode-textmate";
import * as oniguruma from "vscode-oniguruma";
import * as fs from "fs";
import * as path from "path";

interface Token {
  startIndex: number;
  endIndex: number;
  scopes: string[];
}

let grammar: vsctm.IGrammar | null = null;

beforeAll(async () => {
  // Load WASM for oniguruma
  const wasmPath = path.join(
    __dirname,
    "..",
    "node_modules",
    "vscode-oniguruma",
    "release",
    "onig.wasm"
  );
  const wasmBin = fs.readFileSync(wasmPath);
  await oniguruma.loadWASM(wasmBin);

  const grammarPath = path.join(
    __dirname,
    "..",
    "syntaxes",
    "mysql-test.tmLanguage.json"
  );
  const content = fs.readFileSync(grammarPath, "utf-8");
  const raw = JSON.parse(content) as vsctm.IRawGrammar;
  const registry = new vsctm.Registry({
    onigLib: oniguruma,
    loadGrammar: async (scopeName) => {
      if (scopeName === raw.scopeName) return raw;
      return null;
    },
  });
  grammar = await registry.loadGrammar(raw.scopeName);
});

function tokenizeLine(line: string, prevState?: vsctm.StateStack | null): { tokens: Token[]; ruleStack: vsctm.StateStack | null } {
  if (!grammar) throw new Error("Grammar not loaded");
  const result = grammar.tokenizeLine(line, prevState ?? vsctm.INITIAL);
  return { tokens: result.tokens as unknown as Token[], ruleStack: result.ruleStack };
}

function hasScopeInTokens(
  tokens: Token[],
  scopePart: string
): boolean {
  return tokens.some((t) =>
    t.scopes.some((s) => s.includes(scopePart))
  );
}

function collectAllScopes(tokens: Token[]): string[] {
  const scopes: string[] = [];
  for (const token of tokens) {
    for (const scope of token.scopes) {
      if (!scopes.includes(scope)) {
        scopes.push(scope);
      }
    }
  }
  return scopes;
}

describe("mysql-test grammar: variable highlighting", () => {
  it("should highlight $variable at start of line", () => {
    const { tokens } = tokenizeLine("$check_ipv6_just_check=1;");
    const allScopes = collectAllScopes(tokens);
    const hasVar = allScopes.some((s) =>
      s.includes("variable.other.mtr")
    );
    expect(hasVar, `No variable scope found. Scopes: ${allScopes.join(", ")}`).toBe(true);
  });

  it("should highlight $variable in SELECT", () => {
    const { tokens } = tokenizeLine("SELECT $my_var FROM t1;");
    const hasVar = hasScopeInTokens(tokens, "variable.other.mtr");
    expect(hasVar).toBe(true);
  });

  it("should highlight $variable in --echo", () => {
    const { tokens } = tokenizeLine("--echo $message;");
    const hasVar = hasScopeInTokens(tokens, "variable.other.mtr");
    expect(hasVar).toBe(true);
  });

  it("should highlight $variable in --let declaration", () => {
    const { tokens } = tokenizeLine("--let $counter = 0;");
    const hasVar = hasScopeInTokens(tokens, "variable.other.mtr");
    expect(hasVar).toBe(true);
  });

  it("should highlight $variable in let without -- prefix", () => {
    const { tokens } = tokenizeLine("let $counter = 0;");
    const hasVar = hasScopeInTokens(tokens, "variable.other.mtr");
    expect(hasVar).toBe(true);
  });

  it("should highlight $variable in --eval", () => {
    const { tokens } = tokenizeLine("--eval INSERT INTO t1 VALUES ($val);");
    const hasVar = hasScopeInTokens(tokens, "variable.other.mtr");
    expect(hasVar).toBe(true);
  });

  it("should highlight $variable after --error", () => {
    const { tokens } = tokenizeLine("--error $err_var");
    const hasVar = hasScopeInTokens(tokens, "variable.other.mtr");
    expect(hasVar).toBe(true);
  });

  it("should highlight multiple $variables on same line", () => {
    const { tokens } = tokenizeLine("--echo $a $b $c;");
    const varCount = tokens.filter((t) =>
      t.scopes.some((s) => s.includes("variable.other.mtr"))
    ).length;
    expect(varCount).toBeGreaterThanOrEqual(3);
  });

  it("should highlight $MYSQL_TMP_DIR", () => {
    const { tokens } = tokenizeLine("--let $MYSQL_TMP_DIR = /tmp;");
    const hasVar = hasScopeInTokens(tokens, "variable.other.mtr");
    expect(hasVar).toBe(true);
  });

  it("should highlight $variable with numbers", () => {
    const { tokens } = tokenizeLine("SELECT $var2 FROM t1;");
    const hasVar = hasScopeInTokens(tokens, "variable.other.mtr");
    expect(hasVar).toBe(true);
  });
});

describe("mysql-test grammar: MTR function highlighting", () => {
  it("should highlight query_get_value as function", () => {
    const { tokens } = tokenizeLine("let $v = query_get_value(SHOW STATUS, Variable_name, 1);");
    const hasFunc = hasScopeInTokens(tokens, "entity.name.function.mtr");
    expect(hasFunc, "query_get_value should be highlighted as function").toBe(true);
  });

  it("should highlight convert_error as function", () => {
    const { tokens } = tokenizeLine("let $err = convert_error(ER_UNKNOWN_ERROR);");
    const hasFunc = hasScopeInTokens(tokens, "entity.name.function.mtr");
    expect(hasFunc, "convert_error should be highlighted as function").toBe(true);
  });

  it("should highlight function parentheses", () => {
    const { tokens } = tokenizeLine("let $v = query_get_value(SHOW STATUS, Variable_name, 1);");
    const hasOpenParen = hasScopeInTokens(tokens, "punctuation.definition.arguments.begin.mtr");
    const hasCloseParen = hasScopeInTokens(tokens, "punctuation.definition.arguments.end.mtr");
    expect(hasOpenParen, "opening parenthesis should be highlighted").toBe(true);
    expect(hasCloseParen, "closing parenthesis should be highlighted").toBe(true);
  });

  it.skip("should highlight SQL inside query_get_value arguments (requires source.sql)", () => {
    const { tokens } = tokenizeLine("let $v = query_get_value(SHOW STATUS, Variable_name, 1);");
    const hasShow = hasScopeInTokens(tokens, "keyword.other.sql");
    expect(hasShow, "SHOW inside function args should be highlighted as SQL").toBe(true);
  });

  it("should highlight function args as meta scope", () => {
    const { tokens } = tokenizeLine("let $v = query_get_value(SHOW STATUS, Variable_name, 1);");
    const hasMeta = hasScopeInTokens(tokens, "meta.function-call.arguments.mtr");
    expect(hasMeta, "function arguments should have meta scope").toBe(true);
  });
});

describe("mysql-test grammar: directive SQL isolation", () => {
  it("should NOT highlight SQL keywords in --echo content", () => {
    const { tokens } = tokenizeLine("--echo INSERT INTO t1;");
    // Find the token containing "INSERT"
    const insertToken = tokens.find(
      (t) => t.scopes.some((s) => s.includes("source.mysql-test")) &&
        false // dummy, we check scopes below
    );
    // Check no token has SQL keyword scope for INSERT/INTO
    const hasSqlKeyword = tokens.some((t) =>
      t.scopes.some(
        (s) =>
          s.includes("keyword.other.sql") &&
          !s.includes("directive")
      )
    );
    expect(hasSqlKeyword, "SQL keywords should NOT be highlighted in --echo content").toBe(false);
  });

  it.skip("should highlight SQL keywords in --eval content (requires source.sql)", () => {
    const { tokens } = tokenizeLine("--eval SELECT 1;");
    const hasSelect = tokens.some((t) =>
      t.scopes.some((s) => s.includes("keyword.other.sql.dml"))
    );
    expect(hasSelect, "SELECT should be highlighted as SQL in --eval").toBe(true);
  });

  it.skip("should highlight SQL keywords in standalone SQL (requires source.sql)", () => {
    const { tokens } = tokenizeLine("SELECT * FROM t1;");
    const hasSelect = tokens.some((t) =>
      t.scopes.some((s) => s.includes("keyword.other.sql.dml"))
    );
    const hasFrom = tokens.some((t) =>
      t.scopes.some((s) => s.includes("keyword.other.sql.dml"))
    );
    expect(hasSelect, "SELECT should be highlighted as SQL").toBe(true);
    expect(hasFrom, "FROM should be highlighted as SQL").toBe(true);
  });

  it("should NOT highlight SQL keywords in --let content", () => {
    const { tokens } = tokenizeLine("--let $counter = 0;");
    const hasSqlKeyword = tokens.some((t) =>
      t.scopes.some(
        (s) =>
          s.includes("keyword.other.sql") &&
          !s.includes("directive")
      )
    );
    expect(hasSqlKeyword, "SQL keywords should NOT be highlighted in --let content").toBe(false);
  });

  it("should highlight --error directive correctly", () => {
    const { tokens } = tokenizeLine("--error 1064");
    const hasDirective = hasScopeInTokens(tokens, "entity.name.function.directive");
    const hasSql = tokens.some((t) =>
      t.scopes.some((s) => s.includes("keyword.other.sql"))
    );
    expect(hasDirective, "--error should be highlighted as directive").toBe(true);
    expect(hasSql, "No SQL keywords in --error content").toBe(false);
  });

  it("should highlight if/while as control flow", () => {
    const { tokens: ifTokens } = tokenizeLine("if ($counter)");
    const hasIf = hasScopeInTokens(ifTokens, "keyword.control.conditional");
    expect(hasIf, "if should be highlighted as control flow").toBe(true);

    const { tokens: whileTokens } = tokenizeLine("while ($i)");
    const hasWhile = hasScopeInTokens(whileTokens, "keyword.control.conditional");
    expect(hasWhile, "while should be highlighted as control flow").toBe(true);
  });

  it("should highlight variables inside if/while conditions", () => {
    const { tokens } = tokenizeLine("if ($counter)");
    const hasVar = hasScopeInTokens(tokens, "variable.other.mtr");
    expect(hasVar, "$counter inside if should be highlighted as variable").toBe(true);
  });
});

describe("mysql-test grammar: string highlighting", () => {
  it("should NOT highlight single-quoted string in die (quotes are raw text)", () => {
    const { tokens } = tokenizeLine("die 'test failed';");
    const hasStr = hasScopeInTokens(tokens, "string.quoted.single");
    expect(hasStr).toBe(false);
  });

  it("should NOT highlight double-quoted string in die (quotes are raw text)", () => {
    const { tokens } = tokenizeLine('die "hello world";');
    const hasStr = hasScopeInTokens(tokens, "string.quoted.double");
    expect(hasStr).toBe(false);
  });

  it.skip("should highlight single-quoted string in SQL (requires source.sql)", () => {
    const { tokens } = tokenizeLine("SELECT 'hello' FROM t1;");
    const hasStr = hasScopeInTokens(tokens, "string.quoted.single");
    expect(hasStr).toBe(true);
  });

  it("should NOT highlight double-quoted string in --die (quotes are raw text)", () => {
    const { tokens } = tokenizeLine('--die "quoted message";');
    const hasStr = hasScopeInTokens(tokens, "string.quoted.double");
    expect(hasStr).toBe(false);
  });

  it("should NOT highlight $variable in die raw string", () => {
    const { tokens } = tokenizeLine("--die $tmp_table_stm is NULL");
    const hasVar = hasScopeInTokens(tokens, "variable.other.mtr");
    expect(hasVar, "variables in die should NOT be highlighted as variable").toBe(false);
  });

  it("should highlight die content as unquoted string", () => {
    const { tokens } = tokenizeLine("--die $tmp_table_stm is NULL");
    const hasStr = hasScopeInTokens(tokens, "string.unquoted.mtr");
    expect(hasStr, "die content should be highlighted as string").toBe(true);
  });

  it("should NOT highlight $variable in bare die raw string", () => {
    const { tokens } = tokenizeLine("die '$var is broken';");
    const hasVar = hasScopeInTokens(tokens, "variable.other.mtr");
    expect(hasVar, "variables in bare die should NOT be highlighted as variable").toBe(false);
  });

  it.skip("should highlight backtick string in let with embedded SQL (requires source.sql)", () => {
    const { tokens } = tokenizeLine("let $q= `SELECT VERSION()`;");
    const hasBacktick = hasScopeInTokens(tokens, "string.quoted.backtick");
    const hasSelect = hasScopeInTokens(tokens, "keyword.other.sql.dml");
    expect(hasBacktick, "backtick string should be highlighted").toBe(true);
    expect(hasSelect, "SQL SELECT inside backtick should be highlighted").toBe(true);
  });

  it("should highlight backtick string content as embedded SQL", () => {
    const { tokens } = tokenizeLine("let $q= `SELECT VERSION()`;");
    const hasEmbedded = hasScopeInTokens(tokens, "meta.embedded.sql");
    expect(hasEmbedded, "backtick content should have embedded SQL scope").toBe(true);
  });

  it("should highlight entire --echo content as string", () => {
    const { tokens } = tokenizeLine('--echo "quoted message";');
    const hasStr = hasScopeInTokens(tokens, "string.unquoted.mtr");
    expect(hasStr, "echo content should be highlighted as string").toBe(true);
  });

  it("should NOT treat apostrophe in echo as string delimiter", () => {
    const { tokens } = tokenizeLine("--echo # 6) Get the start position of the 14'th event.");
    const hasStr = hasScopeInTokens(tokens, "string.quoted.single");
    const hasUnquoted = hasScopeInTokens(tokens, "string.unquoted.mtr");
    expect(hasStr, "apostrophe in echo should not start a quoted string").toBe(false);
    expect(hasUnquoted, "entire echo content should be unquoted string").toBe(true);
  });

  it("should highlight echo content with variables", () => {
    const { tokens } = tokenizeLine("echo $var hello world;");
    const hasVar = hasScopeInTokens(tokens, "variable.other.mtr");
    const hasStr = hasScopeInTokens(tokens, "string.unquoted.mtr");
    expect(hasVar, "$var in echo should be highlighted as variable").toBe(true);
    expect(hasStr, "non-variable echo content should be string").toBe(true);
  });

  it("should NOT highlight quoted string in --let (quotes are raw text)", () => {
    const { tokens } = tokenizeLine("--let $file = 'hello.txt';");
    const hasStr = hasScopeInTokens(tokens, "string.quoted.single");
    expect(hasStr).toBe(false);
  });
});

describe("mysql-test grammar: file path highlighting", () => {
  it("should highlight --source path as link", () => {
    const { tokens } = tokenizeLine("--source include/have_innodb.inc");
    const hasLink = hasScopeInTokens(tokens, "markup.underline.link");
    expect(hasLink, "source path should have link scope").toBe(true);
  });

  it("should highlight bare source path as link", () => {
    const { tokens } = tokenizeLine("source include/assert.inc;");
    const hasLink = hasScopeInTokens(tokens, "markup.underline.link");
    expect(hasLink, "bare source path should have link scope").toBe(true);
  });

  it("should highlight $variable in write_file path", () => {
    const { tokens } = tokenizeLine("--write_file $MYSQL_TMP_DIR/test.sql");
    const hasVar = hasScopeInTokens(tokens, "variable.other.mtr");
    expect(hasVar, "$variable in write_file path should be highlighted").toBe(true);
  });

  it("should highlight cat_file path as link", () => {
    const { tokens } = tokenizeLine("cat_file $MYSQL_TMP_DIR/test.sql;");
    const hasLink = hasScopeInTokens(tokens, "markup.underline.link");
    expect(hasLink).toBe(true);
  });

  it("should highlight mkdir path as link", () => {
    const { tokens } = tokenizeLine("--mkdir /tmp/test_dir;");
    const hasLink = hasScopeInTokens(tokens, "markup.underline.link");
    expect(hasLink).toBe(true);
  });

  it("should NOT highlight echo content as link", () => {
    const { tokens } = tokenizeLine("--echo hello world;");
    const hasLink = hasScopeInTokens(tokens, "markup.underline.link");
    expect(hasLink, "echo content should not have link scope").toBe(false);
  });
});

describe("mysql-test grammar: perl block", () => {
  it("should apply source.perl scope to bare perl block with custom end marker", () => {
    const r1 = tokenizeLine("perl END_OF_PERL;");
    const r2 = tokenizeLine('  print "hello\\n";', r1.ruleStack);
    const r3 = tokenizeLine("END_OF_PERL", r2.ruleStack);

    const hasPerl = hasScopeInTokens(r2.tokens, "source.perl");
    expect(hasPerl, "perl code inside block should have source.perl scope").toBe(true);

    const hasPerlAfter = hasScopeInTokens(r3.tokens, "source.perl");
    expect(hasPerlAfter, "after END_OF_PERL should not have source.perl scope").toBe(false);
  });

  it("should apply source.perl scope to bare perl block with EOF end marker", () => {
    const r1 = tokenizeLine("perl;");
    const r2 = tokenizeLine("  my $x = 1;", r1.ruleStack);
    const r3 = tokenizeLine("EOF", r2.ruleStack);

    const hasPerl = hasScopeInTokens(r2.tokens, "source.perl");
    expect(hasPerl, "perl; block content should have source.perl scope").toBe(true);

    const hasPerlAfter = hasScopeInTokens(r3.tokens, "source.perl");
    expect(hasPerlAfter, "after EOF should not have source.perl scope").toBe(false);
  });

  it("should apply source.perl scope to --perl block with custom end marker", () => {
    const r1 = tokenizeLine("--perl END_BLOCK");
    const r2 = tokenizeLine("  my $x = 1;", r1.ruleStack);
    const r3 = tokenizeLine("END_BLOCK", r2.ruleStack);

    const hasPerl = hasScopeInTokens(r2.tokens, "source.perl");
    expect(hasPerl, "--perl block content should have source.perl scope").toBe(true);
  });

  it("should apply source.perl scope to --perl block with EOF end marker", () => {
    const r1 = tokenizeLine("--perl");
    const r2 = tokenizeLine("  my $x = 1;", r1.ruleStack);
    const r3 = tokenizeLine("EOF", r2.ruleStack);

    const hasPerl = hasScopeInTokens(r2.tokens, "source.perl");
    expect(hasPerl, "--perl (no marker) block content should have source.perl scope").toBe(true);
  });

  it("should highlight custom end marker name as string", () => {
    const { tokens } = tokenizeLine("perl MY_EOF;");
    const hasEndMarker = hasScopeInTokens(tokens, "string.unquoted.mtr");
    expect(hasEndMarker, "end marker name should be highlighted as string").toBe(true);
  });

  it("should highlight --perl custom end marker name as string", () => {
    const { tokens } = tokenizeLine("--perl MY_EOF");
    const hasEndMarker = hasScopeInTokens(tokens, "string.unquoted.mtr");
    expect(hasEndMarker, "--perl end marker name should be highlighted as string").toBe(true);
  });

  it("should highlight Perl keywords inside block", () => {
    const r1 = tokenizeLine("perl;");
    const r2 = tokenizeLine("  my $x = 1;", r1.ruleStack);

    const hasKeyword = hasScopeInTokens(r2.tokens, "keyword.control.perl");
    expect(hasKeyword, "my should be highlighted as Perl keyword").toBe(true);
  });

  it("should highlight Perl variables inside block", () => {
    const r1 = tokenizeLine("perl;");
    const r2 = tokenizeLine("  $ENV{PATH} = '/bin';", r1.ruleStack);

    const hasVar = hasScopeInTokens(r2.tokens, "variable.other.readwrite.perl");
    expect(hasVar, "$ENV{PATH} should be highlighted as Perl variable").toBe(true);
  });

  it("should highlight Perl comments inside block", () => {
    const r1 = tokenizeLine("perl;");
    const r2 = tokenizeLine("  # this is a perl comment", r1.ruleStack);

    const hasComment = hasScopeInTokens(r2.tokens, "comment.line.number-sign.perl");
    expect(hasComment, "# comment should be highlighted as Perl comment").toBe(true);
  });

  it("should NOT highlight Perl strings via mtr string rules (source.perl handles them)", () => {
    const r1 = tokenizeLine("perl;");
    const r2 = tokenizeLine("  print 'hello world';", r1.ruleStack);

    // source.perl include is first in perl-content; in test env without perl
    // grammar, the fallback #strings no longer has single-quote rules.
    const hasStr = hasScopeInTokens(r2.tokens, "string.quoted.single.mtr");
    expect(hasStr, "mtr string rules should not fire inside perl block").toBe(false);
  });
});
