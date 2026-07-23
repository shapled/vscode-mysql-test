/**
 * Unified command + variable documentation lookup.
 *
 * Two data sources are merged:
 *   1. src/data/mtr-commands.json — hand-curated entries with syntax,
 *      examples, and doc-page links. Authoritative for hover rendering.
 *   2. assets/commands.json — broader coverage (MySQL + MariaDB) with
 *      summary/description. Used as a fallback when (1) lacks an entry.
 */

import mtrCommandsData from "../data/mtr-commands.json";
import commandsJson from "../../assets/commands.json";
import variablesJson from "../../assets/variables.json";

export interface RichCommandDoc {
  name: string;
  syntax?: string;
  description: string;
  summary: string;
  demos?: string[];
  doc_page?: string;
  /** Flavor(s) where this command is recognized. */
  flavors: ("mysql" | "mariadb")[];
  removed_in?: string;
  added_in?: string;
}

type CommandsByFlavor = Record<string, Record<string, unknown>>;

const COMMANDS_JSON = commandsJson as unknown as CommandsByFlavor;
const MTR_COMMANDS = mtrCommandsData as Array<{
  name: string;
  syntax?: string;
  description: string;
  demos?: string[];
  doc_page?: string;
}>;

// ── Build merged lookup ──────────────────────────────────

const DOC_BASE_URL =
  "https://dev.mysql.com/doc/dev/mysql-server/8.4.8";

/** Map command name (lowercase) → RichCommandDoc. */
const COMMAND_DOCS: Map<string, RichCommandDoc> = (() => {
  const map = new Map<string, RichCommandDoc>();

  // First pass: seed from commands.json to capture flavor coverage.
  for (const flavor of ["mysql", "mariadb"] as const) {
    const table = COMMANDS_JSON[flavor];
    if (!table) continue;
    for (const [name, raw] of Object.entries(table)) {
      if (typeof raw !== "object" || raw === null) continue;
      const entry = raw as {
        description?: string;
        summary?: string;
        removed_in?: string;
        added_in?: string;
      };
      const key = name.toLowerCase();
      const existing = map.get(key);
      if (existing) {
        existing.flavors.push(flavor);
        if (entry.removed_in && !existing.removed_in) {
          existing.removed_in = entry.removed_in;
        }
      } else {
        map.set(key, {
          name: key,
          description: entry.description ?? entry.summary ?? "",
          summary: entry.summary ?? entry.description ?? "",
          flavors: [flavor],
          removed_in: entry.removed_in,
          added_in: entry.added_in,
        });
      }
    }
  }

  // Second pass: overlay rich entries from mtr-commands.json.
  for (const rich of MTR_COMMANDS) {
    const key = rich.name.toLowerCase();
    const base = map.get(key);
    const merged: RichCommandDoc = base
      ? { ...base, ...rich }
      : {
          ...rich,
          name: key,
          description: rich.description,
          summary: rich.description,
          flavors: ["mysql"],
        };
    map.set(key, merged);
  }

  return map;
})();

/** Look up a command by name (case-insensitive). */
export function getCommandDoc(name: string): RichCommandDoc | undefined {
  return COMMAND_DOCS.get(name.toLowerCase());
}

/** All known command names (lowercased). */
export function listCommandNames(): string[] {
  return Array.from(COMMAND_DOCS.keys());
}

/** Build the documentation URL for a command, if it has a doc_page. */
export function commandDocUrl(doc: RichCommandDoc): string | undefined {
  if (!doc.doc_page) return undefined;
  return `${DOC_BASE_URL}/${doc.doc_page}.html`;
}

// ── Variables ────────────────────────────────────────────

type VariablesByVer = Record<string, Record<string, string>>;
const VARIABLES = variablesJson as unknown as VariablesByVer;

/** Look up a built-in variable description (without `$` prefix). */
export function getVariableDoc(name: string): string | undefined {
  const versions = Object.keys(VARIABLES).sort().reverse();
  for (const v of versions) {
    const table = VARIABLES[v];
    if (table && table[name]) {
      return table[name];
    }
  }
  return undefined;
}

// ── MTR functions (expression helpers, hand-curated) ─────

export interface MtrFunction {
  name: string;
  syntax: string;
  description: string;
}

const FUNCTIONS: Map<string, MtrFunction> = new Map([
  [
    "query_get_value",
    {
      name: "query_get_value",
      syntax: "query_get_value(query, col_name, row_num)",
      description:
        "Execute a query and return the value of a specified column in a specified row.",
    },
  ],
  [
    "convert_error",
    {
      name: "convert_error",
      syntax: "convert_error(error)",
      description:
        "Convert between MySQL error code numbers and their symbolic names (e.g., ER_UNKNOWN_ERROR).",
    },
  ],
]);

export function getFunctionDoc(word: string): MtrFunction | undefined {
  return FUNCTIONS.get(word.toLowerCase());
}
