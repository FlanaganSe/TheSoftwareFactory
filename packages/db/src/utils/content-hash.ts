import { createHash } from "node:crypto";

export function computeContentHash(content: unknown): string {
  let serialized: string;
  if (
    content !== null &&
    typeof content === "object" &&
    !Array.isArray(content)
  ) {
    serialized = JSON.stringify(
      content,
      Object.keys(content as Record<string, unknown>).sort(),
    );
  } else {
    serialized = JSON.stringify(content);
  }
  return createHash("sha256").update(serialized).digest("hex");
}
