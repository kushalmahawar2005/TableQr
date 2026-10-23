/** Read a request body with a hard byte ceiling to keep public callbacks bounded. */
export async function readRequestBodyLimited(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)) return null;
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readRequestTextLimited(request: Request, maxBytes: number): Promise<string | null> {
  const body = await readRequestBodyLimited(request, maxBytes);
  return body === null ? null : new TextDecoder().decode(body);
}
