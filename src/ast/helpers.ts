import { Variable } from "@shapled/mtparser/ast";
import type {
  InterpolatedText,
  Span$ as Span,
  Statement$ as Statement,
} from "@shapled/mtparser/ast";

/**
 * Helpers for working with the mtparser AST (0.4+, Gleam-generated classes).
 * Statement/TextPart variants are discriminated via instanceof; fields are
 * plain properties on the class instances.
 */

/** Render an InterpolatedText back to its raw string form. */
export function interpolatedToRaw(text: InterpolatedText): string {
  let out = "";
  for (const part of text) {
    out += part instanceof Variable ? `$${part.name}` : part.text;
  }
  return out;
}

/** Extract variable names referenced in interpolated text. */
export function interpolatedVariables(text: InterpolatedText): string[] {
  const names: string[] = [];
  for (const part of text) {
    if (part instanceof Variable) names.push(part.name);
  }
  return names;
}

/** Get the span of any statement, regardless of variant. */
export function statementSpan(stmt: Statement): Span {
  return stmt.span;
}
