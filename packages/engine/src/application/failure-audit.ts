export interface AuditedFailure {
  name: string;
  message: string;
}

const redactions: ReadonlyArray<[RegExp, string]> = [
  [/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]"],
  [/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\s*[:=]\s*["']?)[^"'&\s,;]+/gi, "$1[REDACTED]"],
  [/(https?:\/\/[^/:?#\s]+:)[^@/\s]+@/gi, "$1[REDACTED]@"],
];

/** Keep actionable error context in the local run audit without persisting credentials or stacks. */
export function auditFailure(error: unknown): AuditedFailure {
  const name = error instanceof Error ? error.name : "UnknownError";
  const originalMessage = error instanceof Error ? error.message : String(error);
  const message = redactions.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), originalMessage)
    .replaceAll("\u0000", "")
    .trim()
    .slice(0, 2_000);
  return {
    name: /^[A-Za-z][A-Za-z0-9_.-]{0,119}$/.test(name) ? name : "Error",
    message: message || "The operation failed without an error message.",
  };
}
