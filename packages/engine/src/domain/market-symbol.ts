/** Normalize Wallex's concatenated market symbols and human-readable BASE/QUOTE pairs. */
export function normalizeMarketSymbol(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/\s*\/\s*/g, "");
  if (!/^[A-Z0-9_-]+$/.test(normalized)) {
    throw new Error(`Invalid market symbol ${JSON.stringify(value)}; use a Wallex symbol such as BTCTMN or a pair such as BTC/TMN.`);
  }
  return normalized;
}
