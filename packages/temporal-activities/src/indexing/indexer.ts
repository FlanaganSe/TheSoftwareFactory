/**
 * Main code indexing pipeline orchestrator.
 *
 * Implements the 10-step pipeline:
 * 1. Enumerate files (git ls-files)
 * 2. Governance filter (security boundary - FIRST)
 * 3. Language detection
 * 4. Parse (tree-sitter WASM)
 * 5. Extract symbols
 * 6. Extract imports
 * 7. Store in Postgres
 * 8. Build dependency graph
 * 9. Detect structure (entry points, module groups)
 * 10. Generate repo map
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FactoryResult, PolicyConfig } from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { type DbInstance, indexRepo } from "@software-factory/db";
import { err, ok } from "neverthrow";
import { filterPaths } from "./governance-filter.js";
import { extractImports } from "./import-extractor.js";
import { createParser, detectLanguage, getLanguage } from "./parser.js";
import type { Language, Node } from "./parser.js";
import { generateRepoMap } from "./repo-map.js";
import { extractSymbols } from "./symbol-extractor.js";
import type {
  ImportEdge,
  IndexOptions,
  IndexResult,
  SupportedLanguage,
  Tag,
} from "./types.js";

const DEFAULT_TOKEN_BUDGET = 1000;

/**
 * Index a repository: parse files, extract symbols, build repo map, persist to Postgres.
 */
export async function indexRepository(
  repoPath: string,
  commitSha: string,
  repoId: string,
  policies: readonly PolicyConfig[],
  db: DbInstance,
  options?: IndexOptions,
): Promise<FactoryResult<IndexResult>> {
  const startTime = performance.now();

  try {
    // Step 1: Enumerate files via git ls-files
    const allFiles = enumerateFiles(repoPath, commitSha);

    // Step 2: Governance filter — FIRST stage, security boundary
    const filterResult = filterPaths(allFiles, policies, repoPath);
    const includedFiles = [...filterResult.included];
    const excludedCount = filterResult.excluded.length;

    // Step 3: Language detection
    const fileLanguages = new Map<string, SupportedLanguage | null>();
    for (const filePath of includedFiles) {
      fileLanguages.set(filePath, detectLanguage(filePath));
    }

    // Step 4 + 5 + 6: Parse, extract symbols, extract imports
    const parser = await createParser();
    const allSymbols: Tag[] = [];
    const allImports: ImportEdge[] = [];
    const fileHashes = new Map<string, string>();
    const fileLineCounts = new Map<string, number>();

    // For incremental: determine changed files
    const changedFiles = options?.previousCommitSha
      ? getChangedFiles(repoPath, options.previousCommitSha, commitSha)
      : null;

    const languageCache = new Map<SupportedLanguage, Language>();

    for (const filePath of includedFiles) {
      const lang = fileLanguages.get(filePath) ?? null;

      // Compute file hash
      const content = readFileSafe(join(repoPath, filePath));
      if (content === null) continue;

      const hash = createHash("sha256").update(content).digest("hex");
      fileHashes.set(filePath, hash);
      fileLineCounts.set(filePath, content.split("\n").length);

      // Skip unchanged files in incremental mode
      if (changedFiles !== null && !changedFiles.has(filePath)) continue;

      if (lang === null) continue; // Unsupported language — tracked but not parsed

      // Parse
      let parseResult: import("./types.js").ParseResult;
      try {
        parseResult = await parser.parse(content, lang);
      } catch {
        // Parse error — skip file, don't abort pipeline
        continue;
      }

      if (parseResult.hasError) {
        // Partial AST — still extract what we can
      }

      // Load language for queries
      let language = languageCache.get(lang);
      if (!language) {
        language = await getLanguage(lang);
        languageCache.set(lang, language);
      }

      const rootNode = parseResult.rootNode as Node;

      // Step 5: Extract symbols
      const symbols = extractSymbols(rootNode, language, lang, filePath);
      allSymbols.push(...symbols);

      // Step 6: Extract imports
      const imports = extractImports(
        rootNode,
        language,
        lang,
        filePath,
        repoPath,
      );
      allImports.push(...imports);
    }

    parser.dispose();

    // Step 7: Store in Postgres
    const versionResult = await indexRepo.createIndexVersion(
      db,
      repoId,
      commitSha,
    );
    if (versionResult.isErr()) return err(versionResult.error);
    const indexVersion = versionResult.value;

    // Step 8 + 9: Build dependency graph and detect structure
    const { entryPoints, moduleGroups } = detectStructure(
      includedFiles,
      allImports,
    );

    // Bulk insert files (included + excluded with governance flag)
    const allFileInserts = [
      ...includedFiles.map((fp) => ({
        filePath: fp,
        fileHash: fileHashes.get(fp) ?? "",
        language: fileLanguages.get(fp) ?? null,
        lineCount: fileLineCounts.get(fp) ?? null,
        isEntryPoint: entryPoints.has(fp),
        moduleGroup: moduleGroups.get(fp) ?? null,
        governanceExcluded: false,
      })),
      ...filterResult.excluded.map((fp) => ({
        filePath: fp,
        fileHash: "",
        language: null,
        lineCount: null,
        isEntryPoint: false,
        moduleGroup: null,
        governanceExcluded: true,
      })),
    ];

    const filesResult = await indexRepo.bulkInsertFiles(
      db,
      indexVersion.id,
      allFileInserts,
    );
    if (filesResult.isErr()) return err(filesResult.error);

    // Bulk insert symbols
    const symbolInserts = allSymbols.map((s) => ({
      filePath: s.filePath,
      symbolName: s.name,
      symbolKind: s.symbolKind,
      lineStart: s.line,
      lineEnd: null,
      parentSymbol: null,
      signature: null,
      isExported: s.isExported,
    }));

    const symbolsResult = await indexRepo.bulkInsertSymbols(
      db,
      indexVersion.id,
      symbolInserts,
    );
    if (symbolsResult.isErr()) return err(symbolsResult.error);

    // Bulk insert dependencies (only resolved, non-external)
    const depInserts = allImports
      .filter(
        (i): i is ImportEdge & { resolvedPath: string } =>
          i.resolvedPath !== null && !i.isExternal,
      )
      .map((i) => ({
        sourceFile: i.sourcePath,
        targetFile: i.resolvedPath,
        importType: i.importType,
      }));

    const depsResult = await indexRepo.bulkInsertDependencies(
      db,
      indexVersion.id,
      depInserts,
    );
    if (depsResult.isErr()) return err(depsResult.error);

    // Mark index as ready
    const readyResult = await indexRepo.markIndexReady(db, indexVersion.id);
    if (readyResult.isErr()) return err(readyResult.error);

    // Step 10: Generate repo map
    const fileInfos = includedFiles
      .filter((fp) => fileLineCounts.has(fp))
      .map((fp) => ({
        filePath: fp,
        lineCount: fileLineCounts.get(fp) ?? 0,
      }));

    const repoMap = generateRepoMap(fileInfos, allSymbols, allImports, {
      tokenBudget: options?.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
      activeFiles: options?.activeFiles,
    });

    const durationMs = Math.round(performance.now() - startTime);

    return ok({
      indexVersionId: indexVersion.id,
      totalFiles: allFiles.length,
      indexedFiles: includedFiles.filter((fp) => fileLanguages.get(fp) !== null)
        .length,
      excludedFiles: excludedCount,
      symbolCount: allSymbols.length,
      dependencyCount: depInserts.length,
      durationMs,
      repoMap,
    });
  } catch (e) {
    return err(
      createFactoryError(
        "unknown_internal",
        `Indexing failed: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }
}

// ── Git helpers ──────────────────────────────────────────────────────────────

function enumerateFiles(repoPath: string, commitSha: string): string[] {
  const output = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", commitSha],
    { cwd: repoPath, encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 },
  );
  return output.trim().split("\n").filter(Boolean);
}

function getChangedFiles(
  repoPath: string,
  previousSha: string,
  currentSha: string,
): Set<string> {
  const output = execFileSync(
    "git",
    ["diff", "--name-only", previousSha, currentSha],
    { cwd: repoPath, encoding: "utf-8" },
  );
  return new Set(output.trim().split("\n").filter(Boolean));
}

function readFileSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

// ── Structure detection ─────────────────────────────────────────────────────

function detectStructure(
  files: readonly string[],
  imports: readonly ImportEdge[],
): {
  entryPoints: Set<string>;
  moduleGroups: Map<string, string>;
} {
  const hasOutbound = new Set<string>();
  const hasInbound = new Set<string>();

  for (const imp of imports) {
    if (imp.resolvedPath && !imp.isExternal) {
      hasOutbound.add(imp.sourcePath);
      hasInbound.add(imp.resolvedPath);
    }
  }

  // Entry points: files with outbound imports but no inbound imports
  const entryPoints = new Set<string>();
  for (const file of files) {
    if (hasOutbound.has(file) && !hasInbound.has(file)) {
      entryPoints.add(file);
    }
  }

  // Module groups: simple directory-based grouping
  const moduleGroups = new Map<string, string>();
  for (const file of files) {
    const parts = file.split("/");
    if (parts.length >= 2) {
      moduleGroups.set(file, parts.slice(0, 2).join("/"));
    }
  }

  return { entryPoints, moduleGroups };
}
