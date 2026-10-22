/** Read a response body with a hard byte limit. */
export async function readTextLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Response body exceeded the ${maxBytes}-byte limit.`);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

/** Read and parse a JSON response with a hard byte limit. */
export async function readJsonLimited<T = unknown>(response: Response, maxBytes: number): Promise<T> {
  const text = await readTextLimited(response, maxBytes);
  return JSON.parse(text.replace(/^\uFEFF/, "")) as T;
}
