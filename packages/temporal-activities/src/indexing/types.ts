/**
 * Shared types for the code indexing pipeline.
 */

export interface Tag {
  readonly filePath: string;
  readonly line: number;
  readonly name: string;
  readonly kind: "def" | "ref";
  readonly symbolKind: SymbolKind;
  readonly isExported: boolean;
}

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "method";

export type ImportType = "static" | "dynamic" | "type_only";

export interface ImportEdge {
  readonly sourcePath: string;
  readonly rawImportPath: string;
  readonly resolvedPath: string | null;
  readonly importedNames: readonly string[] | null;
  readonly importType: ImportType;
  readonly line: number;
  readonly isExternal: boolean;
}

export type SupportedLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java";

export interface ParseResult {
  readonly tree: unknown; // web-tree-sitter Tree
  readonly rootNode: unknown; // web-tree-sitter Node
  readonly hasError: boolean;
}

export interface ParserBackend {
  parse(source: string, language: SupportedLanguage): Promise<ParseResult>;
  getSupportedLanguages(): readonly SupportedLanguage[];
  dispose(): void;
}

export interface RepoMapEntry {
  readonly filePath: string;
  readonly rank: number;
  readonly keySymbols: readonly string[];
  readonly lineCount: number;
}

export interface RepoMapOptions {
  readonly tokenBudget: number;
  readonly activeFiles?: readonly string[];
  readonly chatMentionedFiles?: readonly string[];
}

export interface IndexOptions {
  readonly previousCommitSha?: string;
  readonly tokenBudget?: number;
  readonly activeFiles?: readonly string[];
}

export interface IndexResult {
  readonly indexVersionId: string;
  readonly totalFiles: number;
  readonly indexedFiles: number;
  readonly excludedFiles: number;
  readonly symbolCount: number;
  readonly dependencyCount: number;
  readonly durationMs: number;
  readonly repoMap: readonly RepoMapEntry[];
}

export interface FilterResult {
  readonly included: readonly string[];
  readonly excluded: readonly string[];
  readonly exclusionReasons: ReadonlyMap<string, string>;
}

export interface IndexedFile {
  readonly filePath: string;
  readonly language: SupportedLanguage | null;
  readonly lineCount: number;
  readonly fileHash: string;
  readonly isEntryPoint: boolean;
  readonly moduleGroup: string | null;
}
