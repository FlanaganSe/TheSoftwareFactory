/**
 * Symbol extraction via tree-sitter queries.
 *
 * Extracts function/class/interface/type/variable definitions and call references
 * from parsed ASTs using language-specific .scm query patterns.
 */

import { Query } from "web-tree-sitter";
import type { Language, Node } from "web-tree-sitter";
import type { SupportedLanguage, SymbolKind, Tag } from "./types.js";

// ── Query patterns per language ──────────────────────────────────────────────

const TYPESCRIPT_DEFINITIONS = `
(function_declaration name: (identifier) @name) @definition.function
(class_declaration name: (type_identifier) @name) @definition.class
(interface_declaration name: (type_identifier) @name) @definition.interface
(type_alias_declaration name: (type_identifier) @name) @definition.type
(method_definition name: (property_identifier) @name) @definition.method
(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: (arrow_function))) @definition.function
(lexical_declaration
  (variable_declarator
    name: (identifier) @name)) @definition.variable
`;

const JAVASCRIPT_DEFINITIONS = `
(function_declaration name: (identifier) @name) @definition.function
(class_declaration name: (identifier) @name) @definition.class
(method_definition name: (property_identifier) @name) @definition.method
(lexical_declaration
  (variable_declarator
    name: (identifier) @name
    value: (arrow_function))) @definition.function
(lexical_declaration
  (variable_declarator
    name: (identifier) @name)) @definition.variable
`;

const PYTHON_DEFINITIONS = `
(function_definition name: (identifier) @name) @definition.function
(class_definition name: (identifier) @name) @definition.class
`;

const GO_DEFINITIONS = `
(function_declaration name: (identifier) @name) @definition.function
(method_declaration name: (field_identifier) @name) @definition.method
(type_declaration (type_spec name: (type_identifier) @name)) @definition.type
`;

const RUST_DEFINITIONS = `
(function_item name: (identifier) @name) @definition.function
(struct_item name: (type_identifier) @name) @definition.class
(enum_item name: (type_identifier) @name) @definition.class
(trait_item name: (type_identifier) @name) @definition.interface
(impl_item type: (type_identifier) @name) @definition.class
`;

const JAVA_DEFINITIONS = `
(method_declaration name: (identifier) @name) @definition.method
(class_declaration name: (identifier) @name) @definition.class
(interface_declaration name: (identifier) @name) @definition.interface
`;

const CALL_REFERENCES: Record<string, string> = {
  typescript: "(call_expression function: (identifier) @name) @reference.call",
  javascript: "(call_expression function: (identifier) @name) @reference.call",
  python: "(call function: (identifier) @name) @reference.call",
  go: "(call_expression function: (identifier) @name) @reference.call",
  rust: "(call_expression function: (identifier) @name) @reference.call",
  java: "(method_invocation name: (identifier) @name) @reference.call",
};

const DEFINITION_QUERIES: Record<string, string> = {
  typescript: TYPESCRIPT_DEFINITIONS,
  javascript: JAVASCRIPT_DEFINITIONS,
  python: PYTHON_DEFINITIONS,
  go: GO_DEFINITIONS,
  rust: RUST_DEFINITIONS,
  java: JAVA_DEFINITIONS,
};

// ── Capture name → SymbolKind mapping ────────────────────────────────────────

function captureToSymbolKind(captureName: string): SymbolKind {
  if (captureName.includes("function")) return "function";
  if (captureName.includes("class")) return "class";
  if (captureName.includes("interface")) return "interface";
  if (captureName.includes("type")) return "type";
  if (captureName.includes("method")) return "method";
  if (captureName.includes("variable")) return "variable";
  return "variable";
}

// ── Export detection ─────────────────────────────────────────────────────────

function isNodeExported(node: Node, language: SupportedLanguage): boolean {
  switch (language) {
    case "typescript":
    case "javascript": {
      // Check if parent is export_statement
      const parent = node.parent;
      if (parent?.type === "export_statement") return true;
      return false;
    }
    case "python":
      // Python: module-level definitions are considered exported
      // (no leading underscore)
      return node.parent?.type === "module";
    case "go":
      // Go: capitalized first letter = exported
      return false; // Handled at name level below
    case "rust":
      // Rust: pub keyword
      return nodeTextStartsWith(node, "pub ");
    case "java":
      // Java: public keyword
      return nodeTextStartsWith(node, "public ");
  }
}

function isSymbolExported(
  name: string,
  defNode: Node,
  language: SupportedLanguage,
): boolean {
  if (language === "go") {
    return (
      name.length > 0 &&
      name[0] === name[0].toUpperCase() &&
      name[0] !== name[0].toLowerCase()
    );
  }
  return isNodeExported(defNode, language);
}

function nodeTextStartsWith(node: Node, prefix: string): boolean {
  const text = node.text;
  return text.startsWith(prefix);
}

// ── Main extraction function ─────────────────────────────────────────────────

/**
 * Extract symbols (definitions + references) from a parsed AST.
 */
export function extractSymbols(
  rootNode: Node,
  language: Language,
  lang: SupportedLanguage,
  filePath: string,
): Tag[] {
  const tags: Tag[] = [];

  // Extract definitions
  const defQueryStr = DEFINITION_QUERIES[lang];
  if (defQueryStr) {
    try {
      const defQuery = new Query(language, defQueryStr.trim());
      const matches = defQuery.matches(rootNode);

      // Deduplicate: same name+line → prefer function over variable
      const KIND_PRIORITY: Record<string, number> = {
        function: 5,
        class: 5,
        interface: 5,
        type: 5,
        method: 4,
        variable: 1,
      };
      const defsByKey = new Map<string, Tag>();

      for (const match of matches) {
        const nameCapture = match.captures.find((c) => c.name === "name");
        const defCapture = match.captures.find((c) =>
          c.name.startsWith("definition."),
        );

        if (!nameCapture || !defCapture) continue;

        const name = nameCapture.node.text;
        const symbolKind = captureToSymbolKind(defCapture.name);
        const exported = isSymbolExported(name, defCapture.node, lang);
        const line = nameCapture.node.startPosition.row + 1;

        const key = `${name}:${line}`;
        const existing = defsByKey.get(key);
        if (
          existing &&
          (KIND_PRIORITY[existing.symbolKind] ?? 0) >=
            (KIND_PRIORITY[symbolKind] ?? 0)
        ) {
          continue;
        }

        defsByKey.set(key, {
          filePath,
          line,
          name,
          kind: "def",
          symbolKind,
          isExported: exported,
        });
      }

      tags.push(...defsByKey.values());
      defQuery.delete();
    } catch {
      // Query parse error — skip definitions for this language
    }
  }

  // Extract call references
  const refQueryStr = CALL_REFERENCES[lang];
  if (refQueryStr) {
    try {
      const refQuery = new Query(language, refQueryStr.trim());
      const matches = refQuery.matches(rootNode);

      for (const match of matches) {
        const nameCapture = match.captures.find((c) => c.name === "name");
        if (!nameCapture) continue;

        tags.push({
          filePath,
          line: nameCapture.node.startPosition.row + 1,
          name: nameCapture.node.text,
          kind: "ref",
          symbolKind: "function",
          isExported: false,
        });
      }

      refQuery.delete();
    } catch {
      // Query parse error — skip references
    }
  }

  return tags;
}
