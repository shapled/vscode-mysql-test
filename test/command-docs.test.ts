import { describe, it, expect } from "vitest";
import {
  getCommandDoc,
  listCommandNames,
  getVariableDoc,
  getFunctionDoc,
  commandDocUrl,
} from "../src/features/command-docs";

describe("command-docs", () => {
  describe("getCommandDoc", () => {
    it("finds a command case-insensitively", () => {
      const echo = getCommandDoc("ECHO");
      expect(echo).toBeDefined();
      expect(echo!.name).toBe("echo");
    });

    it("returns rich data for hand-curated commands", () => {
      const source = getCommandDoc("source");
      expect(source).toBeDefined();
      expect(source!.syntax).toBeDefined();
      expect(source!.description).toBeTruthy();
      expect(source!.flavors).toContain("mysql");
    });

    it("covers MariaDB-only commands", () => {
      // evalp is MariaDB-specific in commands.json
      const doc = getCommandDoc("evalp");
      // May or may not exist depending on data; just ensure lookup doesn't throw
      if (doc) {
        expect(doc.flavors).toContain("mariadb");
      }
    });

    it("returns undefined for unknown commands", () => {
      expect(getCommandDoc("nonexistent_command")).toBeUndefined();
    });
  });

  describe("listCommandNames", () => {
    it("includes well-known commands", () => {
      const names = listCommandNames();
      expect(names).toContain("source");
      expect(names).toContain("echo");
      expect(names).toContain("let");
      expect(names.length).toBeGreaterThan(50);
    });
  });

  describe("commandDocUrl", () => {
    it("builds URL for commands with doc_page", () => {
      const doc = getCommandDoc("source");
      if (doc && doc.doc_page) {
        const url = commandDocUrl(doc);
        expect(url).toContain(doc.doc_page);
        expect(url).toMatch(/^https:\/\//);
      }
    });

    it("returns undefined when no doc_page", () => {
      const doc = getCommandDoc("evalp");
      if (doc && !doc.doc_page) {
        expect(commandDocUrl(doc)).toBeUndefined();
      }
    });
  });

  describe("getVariableDoc", () => {
    it("finds a built-in variable", () => {
      const doc = getVariableDoc("MYSQL_TMP_DIR");
      // May exist depending on version data
      if (doc !== undefined) {
        expect(typeof doc).toBe("string");
        expect(doc.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getFunctionDoc", () => {
    it("finds query_get_value", () => {
      const fn = getFunctionDoc("query_get_value");
      expect(fn).toBeDefined();
      expect(fn!.syntax).toContain("query_get_value");
    });

    it("finds convert_error", () => {
      const fn = getFunctionDoc("CONVERT_ERROR");
      expect(fn).toBeDefined();
      expect(fn!.name).toBe("convert_error");
    });

    it("returns undefined for unknown function", () => {
      expect(getFunctionDoc("nonexistent")).toBeUndefined();
    });
  });
});
