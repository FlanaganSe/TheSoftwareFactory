import chalk from "chalk";

export interface DiffAnnotationDisplay {
  readonly file: string;
  readonly hunkIndex: number;
  readonly annotation: string;
  readonly riskLevel: string;
  readonly affectedConsumers: readonly string[];
}

export interface ProtectedEditDisplay {
  readonly filePath: string;
  readonly protectionClass: string;
  readonly justification: string;
}

export function formatAnnotatedDiff(
  annotations: readonly DiffAnnotationDisplay[],
  protectedEdits: readonly ProtectedEditDisplay[],
): string {
  const lines: string[] = [];
  const c = chalk;

  const protectedPaths = new Set(protectedEdits.map((e) => e.filePath));

  // Group annotations by file
  const byFile = new Map<string, DiffAnnotationDisplay[]>();
  for (const ann of annotations) {
    const existing = byFile.get(ann.file) ?? [];
    existing.push(ann);
    byFile.set(ann.file, existing);
  }

  const files = [...byFile.entries()];
  for (let i = 0; i < files.length; i++) {
    const [file, anns] = files[i];
    const isLast = i === files.length - 1;
    const prefix = isLast ? "└" : i === 0 ? "┌" : "├";

    const riskLevels = anns.map((a) => a.riskLevel);
    const maxRisk = riskLevels.includes("high")
      ? "high"
      : riskLevels.includes("medium")
        ? "medium"
        : "low";

    const riskColor =
      maxRisk === "high" ? c.red : maxRisk === "medium" ? c.yellow : c.green;
    const riskLabel = riskColor(`[${maxRisk} risk]`);

    const consumers = [...new Set(anns.flatMap((a) => a.affectedConsumers))];

    const isProtected = protectedPaths.has(file);
    const protectedBanner = isProtected ? c.red.bold(" ⚠ PROTECTED") : "";

    lines.push(
      `${c.dim(prefix)} ${c.bold(file)} ${riskLabel}${protectedBanner}`,
    );

    for (const ann of anns) {
      const linePrefix = isLast ? "   " : "│  ";
      lines.push(`${c.dim(linePrefix)}${ann.annotation}`);
    }

    if (consumers.length > 0) {
      const linePrefix = isLast ? "   " : "│  ";
      lines.push(
        `${c.dim(linePrefix)}Consumers: ${c.dim(consumers.join(", "))}`,
      );
    }

    // Show protection details
    if (isProtected) {
      const linePrefix = isLast ? "   " : "│  ";
      const edit = protectedEdits.find((e) => e.filePath === file);
      if (edit) {
        lines.push(
          `${c.dim(linePrefix)}${c.red(`Protection: ${edit.protectionClass}`)} — ${edit.justification}`,
        );
      }
    }
  }

  return lines.join("\n");
}
