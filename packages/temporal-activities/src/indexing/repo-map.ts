/**
 * Aider-style PageRank repo map.
 *
 * Builds a graph from symbol reference relationships and runs personalized
 * PageRank to produce a ranked list of files within a token budget.
 */

import type { ImportEdge, RepoMapEntry, RepoMapOptions, Tag } from "./types.js";

interface FileInfo {
  readonly filePath: string;
  readonly lineCount: number;
}

const DAMPING_FACTOR = 0.85;
const MAX_ITERATIONS = 20;
const CONVERGENCE_THRESHOLD = 0.0001;
const DEFAULT_TOKEN_BUDGET = 1000;
const CHARS_PER_TOKEN = 4;

/**
 * Generate a ranked repo map using personalized PageRank.
 */
export function generateRepoMap(
  files: readonly FileInfo[],
  symbols: readonly Tag[],
  dependencies: readonly ImportEdge[],
  options: RepoMapOptions,
): RepoMapEntry[] {
  const budget = options.tokenBudget || DEFAULT_TOKEN_BUDGET;
  if (files.length === 0) return [];

  const fileSet = new Set(files.map((f) => f.filePath));
  const fileIndex = new Map<string, number>();
  files.forEach((f, i) => fileIndex.set(f.filePath, i));

  const n = files.length;

  // Build adjacency: file A references a symbol defined in file B → edge from A to B
  const defsByName = buildDefinitionIndex(symbols, fileSet);
  const refsByFile = buildReferenceIndex(symbols, fileSet);
  const totalFiles = fileSet.size;

  // Compute reference counts per symbol name (for ubiquity detection)
  const refCountByName = new Map<string, number>();
  for (const tag of symbols) {
    if (tag.kind === "ref") {
      refCountByName.set(tag.name, (refCountByName.get(tag.name) ?? 0) + 1);
    }
  }

  // Also use import edges for the graph
  const importEdges = dependencies.filter(
    (d) => d.resolvedPath !== null && !d.isExternal,
  );

  // Build weighted adjacency matrix (sparse)
  const outEdges: Map<number, Map<number, number>> = new Map();

  // Symbol-based edges: ref in file A, def in file B → A→B
  for (const [filePath, refs] of refsByFile) {
    const fromIdx = fileIndex.get(filePath);
    if (fromIdx === undefined) continue;

    for (const ref of refs) {
      const defs = defsByName.get(ref.name);
      if (!defs) continue;

      for (const def of defs) {
        const toIdx = fileIndex.get(def.filePath);
        if (toIdx === undefined || toIdx === fromIdx) continue;

        const weight = computeEdgeWeight(
          ref.name,
          def.isExported,
          refCountByName.get(ref.name) ?? 0,
          totalFiles,
        );

        const edgeMap = outEdges.get(fromIdx) ?? new Map<number, number>();
        if (!outEdges.has(fromIdx)) outEdges.set(fromIdx, edgeMap);
        const edges = edgeMap;
        edges.set(toIdx, (edges.get(toIdx) ?? 0) + weight);
      }
    }
  }

  // Import-based edges: source imports target → source→target
  for (const imp of importEdges) {
    const fromIdx = fileIndex.get(imp.sourcePath);
    const toIdx = imp.resolvedPath
      ? fileIndex.get(imp.resolvedPath)
      : undefined;
    if (fromIdx === undefined || toIdx === undefined || fromIdx === toIdx)
      continue;

    const impEdgeMap = outEdges.get(fromIdx) ?? new Map<number, number>();
    if (!outEdges.has(fromIdx)) outEdges.set(fromIdx, impEdgeMap);
    impEdgeMap.set(toIdx, (impEdgeMap.get(toIdx) ?? 0) + 1.0);
  }

  // Build personalization vector
  const personalization = buildPersonalization(
    files,
    options.activeFiles ?? [],
    options.chatMentionedFiles ?? [],
  );

  // Run PageRank
  const ranks = pageRank(n, outEdges, personalization);

  // Build key symbols per file (top exported symbols by reference count)
  const keySymbolsPerFile = buildKeySymbols(symbols, fileSet, refCountByName);

  // Sort files by rank and select within token budget
  const ranked: { filePath: string; rank: number; idx: number }[] = [];
  for (let i = 0; i < n; i++) {
    ranked.push({ filePath: files[i].filePath, rank: ranks[i], idx: i });
  }
  ranked.sort((a, b) => b.rank - a.rank);

  const result: RepoMapEntry[] = [];
  let tokenCount = 0;

  for (const entry of ranked) {
    const keySyms = keySymbolsPerFile.get(entry.filePath) ?? [];
    const line = formatMapLine(entry.filePath, keySyms);
    const lineTokens = Math.ceil(line.length / CHARS_PER_TOKEN);

    if (tokenCount + lineTokens > budget && result.length > 0) break;

    result.push({
      filePath: entry.filePath,
      rank: entry.rank,
      keySymbols: keySyms,
      lineCount: files[entry.idx].lineCount,
    });

    tokenCount += lineTokens;
  }

  return result;
}

// ── PageRank ─────────────────────────────────────────────────────────────────

function pageRank(
  n: number,
  outEdges: Map<number, Map<number, number>>,
  personalization: Float64Array,
): Float64Array {
  let ranks = new Float64Array(n).fill(1.0 / n);
  const newRanks = new Float64Array(n);

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    newRanks.fill(0);

    // Distribute rank through edges
    for (let i = 0; i < n; i++) {
      const edges = outEdges.get(i);
      if (!edges || edges.size === 0) {
        // Dangling node: distribute to all nodes via personalization
        for (let j = 0; j < n; j++) {
          newRanks[j] += ranks[i] * personalization[j];
        }
        continue;
      }

      let totalWeight = 0;
      for (const w of edges.values()) totalWeight += w;

      for (const [target, weight] of edges) {
        newRanks[target] += DAMPING_FACTOR * ranks[i] * (weight / totalWeight);
      }
    }

    // Add teleportation (personalization)
    const danglingMass = 1.0 - newRanks.reduce((s, v) => s + v, 0);
    for (let i = 0; i < n; i++) {
      newRanks[i] +=
        (1.0 - DAMPING_FACTOR) * personalization[i] +
        danglingMass * personalization[i];
    }

    // Check convergence
    let diff = 0;
    for (let i = 0; i < n; i++) {
      diff += Math.abs(newRanks[i] - ranks[i]);
    }

    ranks = Float64Array.from(newRanks);

    if (diff < CONVERGENCE_THRESHOLD) break;
  }

  return ranks;
}

// ── Helper functions ─────────────────────────────────────────────────────────

function buildPersonalization(
  files: readonly FileInfo[],
  activeFiles: readonly string[],
  chatMentionedFiles: readonly string[],
): Float64Array {
  const n = files.length;
  const weights = new Float64Array(n).fill(1.0);

  const activeSet = new Set(activeFiles);
  const mentionedSet = new Set(chatMentionedFiles);

  for (let i = 0; i < n; i++) {
    const fp = files[i].filePath;
    if (activeSet.has(fp)) weights[i] = 50.0;
    else if (mentionedSet.has(fp)) weights[i] = 10.0;
  }

  // Normalize
  const total = weights.reduce((s, v) => s + v, 0);
  if (total > 0) {
    for (let i = 0; i < n; i++) {
      weights[i] /= total;
    }
  }

  return weights;
}

function buildDefinitionIndex(
  symbols: readonly Tag[],
  fileSet: Set<string>,
): Map<string, Tag[]> {
  const index = new Map<string, Tag[]>();
  for (const tag of symbols) {
    if (tag.kind !== "def" || !fileSet.has(tag.filePath)) continue;
    const existing = index.get(tag.name);
    if (existing) existing.push(tag);
    else index.set(tag.name, [tag]);
  }
  return index;
}

function buildReferenceIndex(
  symbols: readonly Tag[],
  fileSet: Set<string>,
): Map<string, Tag[]> {
  const index = new Map<string, Tag[]>();
  for (const tag of symbols) {
    if (tag.kind !== "ref" || !fileSet.has(tag.filePath)) continue;
    const existing = index.get(tag.filePath);
    if (existing) existing.push(tag);
    else index.set(tag.filePath, [tag]);
  }
  return index;
}

function computeEdgeWeight(
  name: string,
  isExported: boolean,
  refCount: number,
  totalFiles: number,
): number {
  let weight = 1.0;

  // Long identifier (>15 chars) → more specific → upweight
  if (name.length > 15) weight *= 10.0;

  // Private/unexported symbol → downweight
  if (!isExported) weight *= 0.1;

  // Ubiquitous symbol (referenced by >30% of files) → downweight
  if (totalFiles > 0 && refCount > totalFiles * 0.3) weight *= 0.1;

  return weight;
}

function buildKeySymbols(
  symbols: readonly Tag[],
  fileSet: Set<string>,
  refCountByName: Map<string, number>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();

  // Group exported definitions by file
  const exportedByFile = new Map<string, { name: string; refs: number }[]>();
  for (const tag of symbols) {
    if (tag.kind !== "def" || !tag.isExported || !fileSet.has(tag.filePath))
      continue;
    const existing = exportedByFile.get(tag.filePath);
    const entry = { name: tag.name, refs: refCountByName.get(tag.name) ?? 0 };
    if (existing) existing.push(entry);
    else exportedByFile.set(tag.filePath, [entry]);
  }

  for (const [filePath, defs] of exportedByFile) {
    // Sort by reference count descending, take top 5
    defs.sort((a, b) => b.refs - a.refs);
    result.set(
      filePath,
      defs.slice(0, 5).map((d) => d.name),
    );
  }

  return result;
}

function formatMapLine(
  filePath: string,
  keySymbols: readonly string[],
): string {
  if (keySymbols.length === 0) return filePath;
  return `${filePath}: ${keySymbols.join(", ")}`;
}
