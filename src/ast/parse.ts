import { parse } from "@shapled/mtparser";
import { to_string as parserErrorToString } from "@shapled/mtparser/error";
import type { ParserError$ } from "@shapled/mtparser/error";
import type { Statement$ } from "@shapled/mtparser/ast";

export type {
  Statement$ as Statement,
  Span$ as Span,
  TextPart$ as TextPart,
  InterpolatedText,
} from "@shapled/mtparser/ast";

/**
 * Adapter over the mtparser 0.4+ API.
 *
 * mtparser is now a pure-JS (Gleam-compiled) package whose `parse` returns a
 * Gleam `Result` instead of throwing. The Result's payload lives at index 0
 * (the prelude classes are not exported as a public subpath, so we unwrap
 * structurally). The parser is fail-fast: one syntax error discards the
 * whole file — surface that as a thrown Error with the formatted message.
 */

/** Gleam `Ok` value holder (structural view of the generated Ok class). */
interface OkBox<T> {
  readonly 0: T;
}

/** Gleam cons-list (structural view — iterable, with toArray()). */
interface GleamList<T> extends Iterable<T> {
  toArray(): T[];
}

/** Parse a mysqltest/mariadb-test file. Throws on syntax errors. */
export function parseMt(input: string): Statement$[] {
  const result = parse(input);
  if (result.isOk()) {
    const statements = (result as unknown as OkBox<GleamList<Statement$>>)[0];
    return statements.toArray();
  }
  const err = (result as unknown as OkBox<ParserError$>)[0];
  throw new Error(parserErrorToString(err));
}
