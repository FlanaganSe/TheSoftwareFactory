/**
 * Import/dependency extraction from parsed ASTs.
 *
 * Extracts import statements, resolves relative paths to file paths,
 * and identifies external packages.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Query } from "web-tree-sitter";
import type { Language, Node } from "web-tree-sitter";
import type { ImportEdge, ImportType, SupportedLanguage } from "./types.js";

// ── Query patterns per language ──────────────────────────────────────────────

const TS_IMPORT_QUERIES = `
(import_statement
  source: (string (string_fragment) @source)) @import.static

(import_statement "type"
  source: (string (string_fragment) @source)) @import.type

(export_statement
  source: (string (string_fragment) @source)) @import.reexport

(call_expression
  function: (import)
  arguments: (arguments (string (string_fragment) @source))) @import.dynamic

(call_expression
  function: (identifier) @_func
  arguments: (arguments (string (string_fragment) @source))
  (#eq? @_func "require")) @import.require
`;

const JS_IMPORT_QUERIES = `
(import_statement
  source: (string (string_fragment) @source)) @import.static

(export_statement
  source: (string (string_fragment) @source)) @import.reexport

(call_expression
  function: (import)
  arguments: (arguments (string (string_fragment) @source))) @import.dynamic

(call_expression
  function: (identifier) @_func
  arguments: (arguments (string (string_fragment) @source))
  (#eq? @_func "require")) @import.require
`;

const PYTHON_IMPORT_QUERIES = `
(import_statement
  name: (dotted_name) @source) @import.static

(import_from_statement
  module_name: (dotted_name) @source) @import.static

(import_from_statement
  module_name: (relative_import) @source) @import.static
`;

const GO_IMPORT_QUERIES = `
(import_declaration
  (import_spec
    path: (interpreted_string_literal) @source)) @import.static

(import_declaration
  (import_spec_list
    (import_spec
      path: (interpreted_string_literal) @source))) @import.static
`;

const RUST_IMPORT_QUERIES = `
(use_declaration
  argument: (scoped_identifier) @source) @import.static

(use_declaration
  argument: (use_wildcard) @source) @import.static
`;

const JAVA_IMPORT_QUERIES = `
(import_declaration
  (scoped_identifier) @source) @import.static
`;

const IMPORT_QUERIES: Record<string, string> = {
  typescript: TS_IMPORT_QUERIES,
  javascript: JS_IMPORT_QUERIES,
  python: PYTHON_IMPORT_QUERIES,
  go: GO_IMPORT_QUERIES,
  rust: RUST_IMPORT_QUERIES,
  java: JAVA_IMPORT_QUERIES,
};

// ── Resolution helpers ──────────────────────────────────────────────────────

const TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const INDEX_FILES = ["index.ts", "index.tsx", "index.js", "index.jsx"];

function isRelativeImport(importPath: string): boolean {
  return importPath.startsWith("./") || importPath.startsWith("../");
}

function isExternalPackage(
  importPath: string,
  language: SupportedLanguage,
): boolean {
  switch (language) {
    case "typescript":
    case "javascript":
      return !isRelativeImport(importPath);
    case "python":
      // Relative imports start with dots
      return !importPath.startsWith(".");
    case "go":
      // Standard library has no dots in first path component
      // External packages typically have a domain
      return importPath.includes(".");
    case "rust":
    case "java":
      return true; // Rust/Java imports are handled differently
  }
}

/**
 * Resolve a relative import path to an actual file path.
 * Tries extension probing and index file resolution.
 */
export function resolveRelativeImport(
  importPath: string,
  sourceFilePath: string,
  repoRoot: string,
): string | null {
  const sourceDir = dirname(join(repoRoot, sourceFilePath));
  const basePath = resolve(sourceDir, importPath);
  const relativize = (p: string): string => {
    const rel = p.slice(repoRoot.length);
    return rel.startsWith("/") ? rel.slice(1) : rel;
  };

  // Try exact path
  if (existsSync(basePath) && !isDirectory(basePath)) {
    return relativize(basePath);
  }

  // Try with extensions
  for (const ext of TS_EXTENSIONS) {
    const withExt = basePath + ext;
    if (existsSync(withExt)) {
      return relativize(withExt);
    }
  }

  // Try as directory with index file
  for (const indexFile of INDEX_FILES) {
    const indexPath = join(basePath, indexFile);
    if (existsSync(indexPath)) {
      return relativize(indexPath);
    }
  }

  return null;
}

function isDirectory(filePath: string): boolean {
  try {
    const { statSync } = require("node:fs") as typeof import("node:fs");
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

// ── Imported names extraction ────────────────────────────────────────────────

function extractImportedNames(
  importNode: Node,
  language: SupportedLanguage,
): readonly string[] | null {
  if (language !== "typescript" && language !== "javascript") {
    return null;
  }

  // Look for import_clause → named_imports → import_specifier(s)
  const clause =
    importNode.childForFieldName("import_clause") ??
    findChild(importNode, "import_clause");
  if (!clause) return null;

  const namedImports = findChild(clause, "named_imports");
  if (!namedImports) return null;

  const names: string[] = [];
  for (let i = 0; i < namedImports.namedChildCount; i++) {
    const child = namedImports.namedChild(i);
    if (child?.type === "import_specifier") {
      const name = child.childForFieldName("name") ?? child.firstNamedChild;
      if (name) names.push(name.text);
    }
  }
  return names.length > 0 ? names : null;
}

function findChild(node: Node, type: string): Node | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === type) return child;
  }
  return null;
}

// ── Import type detection ────────────────────────────────────────────────────

function determineImportType(captureName: string): ImportType {
  if (captureName === "import.type") return "type_only";
  if (captureName === "import.dynamic") return "dynamic";
  return "static";
}

// ── Main extraction function ─────────────────────────────────────────────────

/**
 * Extract import edges from a parsed AST.
 */
export function extractImports(
  rootNode: Node,
  language: Language,
  lang: SupportedLanguage,
  filePath: string,
  repoRoot: string,
): ImportEdge[] {
  const edges: ImportEdge[] = [];

  const queryStr = IMPORT_QUERIES[lang];
  if (!queryStr) return edges;

  let query: InstanceType<typeof Query> | null = null;
  try {
    query = new Query(language, queryStr.trim());
  } catch {
    // Query parse error for this language
    return edges;
  }

  const matches = query.matches(rootNode);

  // Collect by line, preferring more specific import types
  // (type_only > dynamic > static) when multiple patterns match the same import
  const byLine = new Map<number, ImportEdge>();
  const TYPE_PRIORITY: Record<ImportType, number> = {
    type_only: 3,
    dynamic: 2,
    static: 1,
  };

  for (const match of matches) {
    const sourceCapture = match.captures.find((c) => c.name === "source");
    const importCapture = match.captures.find((c) =>
      c.name.startsWith("import."),
    );

    if (!sourceCapture || !importCapture) continue;

    const line = sourceCapture.node.startPosition.row;
    const importType = determineImportType(importCapture.name);

    const existing = byLine.get(line);
    if (
      existing &&
      TYPE_PRIORITY[existing.importType] >= TYPE_PRIORITY[importType]
    ) {
      continue;
    }

    let rawPath = sourceCapture.node.text;
    if (lang === "go") {
      rawPath = rawPath.replace(/^"|"$/g, "");
    }

    const external = isExternalPackage(rawPath, lang);

    let resolvedPath: string | null = null;
    if (!external && isRelativeImport(rawPath)) {
      resolvedPath = resolveRelativeImport(rawPath, filePath, repoRoot);
    }

    const importedNames = extractImportedNames(importCapture.node, lang);

    byLine.set(line, {
      sourcePath: filePath,
      rawImportPath: rawPath,
      resolvedPath,
      importedNames,
      importType,
      line: line + 1,
      isExternal: external,
    });
  }

  edges.push(...byLine.values());

  query.delete();
  return edges;
}
