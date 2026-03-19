import chalk from "chalk";

export interface Column {
  readonly header: string;
  readonly width: number;
  readonly align?: "left" | "right" | "center";
}

export function formatTable(
  columns: readonly Column[],
  rows: readonly (readonly string[])[],
): string {
  const lines: string[] = [];
  const c = chalk;

  const topBorder = `┌${columns.map((col) => "─".repeat(col.width + 2)).join("┬")}┐`;
  const headerSep = `├${columns.map((col) => "─".repeat(col.width + 2)).join("┼")}┤`;
  const bottomBorder = `└${columns.map((col) => "─".repeat(col.width + 2)).join("┴")}┘`;

  lines.push(c.dim(topBorder));

  const headerCells = columns.map(
    (col) => ` ${c.bold(padCell(col.header, col.width, col.align))} `,
  );
  lines.push(c.dim("│") + headerCells.join(c.dim("│")) + c.dim("│"));
  lines.push(c.dim(headerSep));

  for (const row of rows) {
    const cells = columns.map(
      (col, i) => ` ${padCell(row[i] ?? "", col.width, col.align)} `,
    );
    lines.push(c.dim("│") + cells.join(c.dim("│")) + c.dim("│"));
  }

  lines.push(c.dim(bottomBorder));
  return lines.join("\n");
}

function padCell(
  text: string,
  width: number,
  align: "left" | "right" | "center" = "left",
): string {
  const stripped = stripAnsi(text);
  const padding = Math.max(0, width - stripped.length);

  if (align === "right") return " ".repeat(padding) + text;
  if (align === "center") {
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return " ".repeat(left) + text + " ".repeat(right);
  }
  return text + " ".repeat(padding);
}

function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes are control chars by definition
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}
