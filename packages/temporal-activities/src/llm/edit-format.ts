import type { FactoryError } from "@software-factory/core";
import { type Result, err, ok } from "neverthrow";

export interface EditResult {
  readonly success: boolean;
  readonly matchType: "exact" | "whitespace" | "fuzzy" | "none";
  readonly newContent: string;
  readonly matchLocation?: { readonly line: number; readonly column: number };
  readonly error?: string;
}

interface ClosestMatch {
  readonly text: string;
  readonly similarity: number;
  readonly line: number;
}

function getLineAndColumn(
  content: string,
  index: number,
): { line: number; column: number } {
  const lines = content.substring(0, index).split("\n");
  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
  };
}

function normalizeWhitespace(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n/g, "\n");
}

function buildLineMap(
  original: string,
  normalized: string,
): Map<number, number> {
  const origLines = original.split("\n");
  const normLines = normalized.split("\n");
  const map = new Map<number, number>();
  let origIdx = 0;
  let normIdx = 0;
  for (let i = 0; i < normLines.length && i < origLines.length; i++) {
    map.set(normIdx, origIdx);
    normIdx += normLines[i]?.length + 1;
    origIdx += origLines[i]?.length + 1;
  }
  return map;
}

function mapNormalizedIndex(
  lineMap: Map<number, number>,
  normIndex: number,
): number {
  let bestNormStart = 0;
  let bestOrigStart = 0;
  for (const [normStart, origStart] of lineMap) {
    if (normStart <= normIndex && normStart >= bestNormStart) {
      bestNormStart = normStart;
      bestOrigStart = origStart;
    }
  }
  return bestOrigStart + (normIndex - bestNormStart);
}

function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  const aLen = a.length;
  const bLen = b.length;
  const prev = Array.from({ length: bLen + 1 }, (_, i) => i);
  const curr = new Array<number>(bLen + 1).fill(0);

  for (let i = 1; i <= aLen; i++) {
    curr[0] = i;
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= bLen; j++) prev[j] = curr[j] ?? 0;
  }

  const distance = prev[bLen] ?? 0;
  return 1 - distance / maxLen;
}

function findClosestMatch(
  content: string,
  search: string,
): ClosestMatch | null {
  const contentLines = content.split("\n");
  const searchLines = search.split("\n");
  const windowSize = searchLines.length;

  let bestMatch: ClosestMatch | null = null;

  for (let i = 0; i <= contentLines.length - windowSize; i++) {
    const window = contentLines.slice(i, i + windowSize).join("\n");
    const similarity = levenshteinSimilarity(window, search);
    if (!bestMatch || similarity > bestMatch.similarity) {
      bestMatch = {
        text: window.length > 200 ? `${window.substring(0, 200)}...` : window,
        similarity,
        line: i + 1,
      };
    }
  }

  return bestMatch;
}

export function applyEdit(
  fileContent: string,
  search: string,
  replace: string,
): EditResult {
  if (search.length === 0) {
    return {
      success: false,
      matchType: "none",
      newContent: fileContent,
      error: "Search string cannot be empty",
    };
  }

  // 1. Exact match
  const exactIdx = fileContent.indexOf(search);
  if (exactIdx !== -1) {
    const newContent =
      fileContent.substring(0, exactIdx) +
      replace +
      fileContent.substring(exactIdx + search.length);
    return {
      success: true,
      matchType: "exact",
      newContent,
      matchLocation: getLineAndColumn(fileContent, exactIdx),
    };
  }

  // 2. Whitespace-tolerant match
  const normalizedContent = normalizeWhitespace(fileContent);
  const normalizedSearch = normalizeWhitespace(search);
  const normIdx = normalizedContent.indexOf(normalizedSearch);

  if (normIdx !== -1) {
    const lineMap = buildLineMap(fileContent, normalizedContent);
    const origStart = mapNormalizedIndex(lineMap, normIdx);
    const origEnd = mapNormalizedIndex(
      lineMap,
      normIdx + normalizedSearch.length,
    );

    const clampedEnd = Math.min(origEnd, fileContent.length);
    const newContent =
      fileContent.substring(0, origStart) +
      replace +
      fileContent.substring(clampedEnd);

    return {
      success: true,
      matchType: "whitespace",
      newContent,
      matchLocation: getLineAndColumn(fileContent, origStart),
    };
  }

  // 3. Fuzzy match (>90% similarity via sliding window)
  // Skip fuzzy matching for large content to avoid O(n*m) Levenshtein
  const MAX_FUZZY_CONTENT_SIZE = 50_000;
  if (
    fileContent.length > MAX_FUZZY_CONTENT_SIZE ||
    search.length > MAX_FUZZY_CONTENT_SIZE
  ) {
    const closest = findClosestMatch(fileContent.substring(0, 10_000), search);
    const searchPreview =
      search.length > 100 ? `${search.substring(0, 100)}...` : search;
    const closestInfo = closest
      ? ` Closest match (${(closest.similarity * 100).toFixed(1)}% similar) at line ${closest.line}`
      : "";
    return {
      success: false,
      matchType: "none" as const,
      newContent: fileContent,
      error: `No match found (fuzzy matching skipped for large content): "${searchPreview}".${closestInfo}`,
    };
  }

  const contentLines = fileContent.split("\n");
  const searchLines = search.split("\n");
  const windowSize = searchLines.length;

  let bestSimilarity = 0;
  let bestWindowStart = -1;
  let bestWindowEnd = -1;

  for (let i = 0; i <= contentLines.length - windowSize; i++) {
    const windowText = contentLines.slice(i, i + windowSize).join("\n");
    const similarity = levenshteinSimilarity(windowText, search);
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestWindowStart = i;
      bestWindowEnd = i + windowSize;
    }
  }

  if (bestSimilarity > 0.9 && bestWindowStart >= 0) {
    const before = contentLines.slice(0, bestWindowStart).join("\n");
    const after = contentLines.slice(bestWindowEnd).join("\n");
    const prefix = bestWindowStart > 0 ? `${before}\n` : "";
    const suffix = bestWindowEnd < contentLines.length ? `\n${after}` : "";
    const newContent = `${prefix}${replace}${suffix}`;

    return {
      success: true,
      matchType: "fuzzy",
      newContent,
      matchLocation: { line: bestWindowStart + 1, column: 1 },
    };
  }

  // 4. No match — provide diagnostic info
  const closest = findClosestMatch(fileContent, search);
  const searchPreview =
    search.length > 100 ? `${search.substring(0, 100)}...` : search;
  const closestInfo = closest
    ? ` Closest match (${(closest.similarity * 100).toFixed(1)}% similar) at line ${closest.line}: "${closest.text}"`
    : "";

  return {
    success: false,
    matchType: "none",
    newContent: fileContent,
    error: `No match found for: "${searchPreview}".${closestInfo}`,
  };
}

export function applyEditSafe(
  fileContent: string,
  search: string,
  replace: string,
): Result<EditResult, FactoryError> {
  try {
    const result = applyEdit(fileContent, search, replace);
    return ok(result);
  } catch (error) {
    return err({
      code: "unknown_internal",
      message: `Edit format error: ${error instanceof Error ? error.message : String(error)}`,
      retryable: false,
    });
  }
}
