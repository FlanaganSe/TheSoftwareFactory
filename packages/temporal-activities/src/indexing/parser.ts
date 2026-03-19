/**
 * tree-sitter parser setup with WASM backend.
 *
 * Uses web-tree-sitter for cross-platform compatibility.
 * Grammar WASM files are loaded from the tree-sitter-* npm packages.
 */

import { createRequire } from "node:module";
import { Language, type Node, Parser, type Tree } from "web-tree-sitter";
import type { ParseResult, ParserBackend, SupportedLanguage } from "./types.js";

// Re-export tree-sitter types for use by extractors
export type { Tree, Node } from "web-tree-sitter";
export { Language, Query } from "web-tree-sitter";

const EXTENSION_TO_LANGUAGE: ReadonlyMap<string, SupportedLanguage> = new Map([
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".js", "javascript"],
  [".jsx", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".py", "python"],
  [".go", "go"],
  [".rs", "rust"],
  [".java", "java"],
]);

const LANGUAGE_TO_WASM: ReadonlyMap<string, string> = new Map([
  ["typescript", "tree-sitter-typescript/tree-sitter-typescript.wasm"],
  ["javascript", "tree-sitter-javascript/tree-sitter-javascript.wasm"],
  ["python", "tree-sitter-python/tree-sitter-python.wasm"],
  ["go", "tree-sitter-go/tree-sitter-go.wasm"],
  ["rust", "tree-sitter-rust/tree-sitter-rust.wasm"],
  ["java", "tree-sitter-java/tree-sitter-java.wasm"],
]);

export function detectLanguage(filePath: string): SupportedLanguage | null {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1) return null;
  const ext = filePath.slice(lastDot).toLowerCase();
  return EXTENSION_TO_LANGUAGE.get(ext) ?? null;
}

let parserInitialized = false;

async function ensureInitialized(): Promise<void> {
  if (!parserInitialized) {
    await Parser.init();
    parserInitialized = true;
  }
}

export async function createParser(): Promise<ParserBackend> {
  await ensureInitialized();

  const loadedLanguages = new Map<SupportedLanguage, Language>();
  const require = createRequire(import.meta.url);

  async function loadLanguage(lang: SupportedLanguage): Promise<Language> {
    const cached = loadedLanguages.get(lang);
    if (cached) return cached;

    const wasmPath = LANGUAGE_TO_WASM.get(lang);
    if (!wasmPath) {
      throw new Error(`No WASM grammar for language: ${lang}`);
    }

    const resolvedPath = require.resolve(wasmPath);
    const language = await Language.load(resolvedPath);
    loadedLanguages.set(lang, language);
    return language;
  }

  return {
    async parse(
      source: string,
      language: SupportedLanguage,
    ): Promise<ParseResult> {
      const lang = await loadLanguage(language);
      const parser = new Parser();
      parser.setLanguage(lang);

      const tree = parser.parse(source) as Tree;
      const rootNode = tree.rootNode as Node;

      const result: ParseResult = {
        tree,
        rootNode,
        hasError: rootNode.hasError,
      };

      parser.delete();
      return result;
    },

    getSupportedLanguages(): readonly SupportedLanguage[] {
      return [...LANGUAGE_TO_WASM.keys()] as SupportedLanguage[];
    },

    dispose(): void {
      loadedLanguages.clear();
    },
  };
}

/**
 * Get the loaded Language object for a given language.
 * Useful for creating queries in extractors.
 */
export async function getLanguage(lang: SupportedLanguage): Promise<Language> {
  await ensureInitialized();
  const require = createRequire(import.meta.url);
  const wasmPath = LANGUAGE_TO_WASM.get(lang);
  if (!wasmPath) {
    throw new Error(`No WASM grammar for language: ${lang}`);
  }
  return Language.load(require.resolve(wasmPath));
}
