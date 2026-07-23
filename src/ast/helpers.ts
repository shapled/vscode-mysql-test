import type {
  Statement,
  Span,
  InterpolatedText,
  TextPart,
} from "@shapled/mtparser";

/**
 * Helpers for working with the mtparser AST.
 *
 * The package ships full types via ts-rs; these helpers provide common
 * operations that the typed AST doesn't cover directly.
 */

/** Render an InterpolatedText back to its raw string form. */
export function interpolatedToRaw(text: InterpolatedText): string {
  return text.map(textPartToRaw).join("");
}

function textPartToRaw(part: TextPart): string {
  return "Literal" in part ? part.Literal.text : `$${part.Variable.name}`;
}

/** Extract variable names referenced in interpolated text. */
export function interpolatedVariables(text: InterpolatedText): string[] {
  return text
    .filter((p): p is Extract<TextPart, { Variable: unknown }> => "Variable" in p)
    .map((p) => p.Variable.name);
}

/** Get the span of any statement, regardless of variant. */
export function statementSpan(stmt: Statement): Span {
  const key = Object.keys(stmt)[0] as keyof Statement;
  const payload = stmt[key];
  // "Empty" variant is a string literal, no payload object
  if (typeof payload === "string" || payload === undefined) {
    return { line: 0, column: 0, offset: 0, len: 0 };
  }
  return (payload as { span: Span }).span;
}
