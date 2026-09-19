const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

export function chunkUtf8Base64(value: string, maxRawBytes = 500_000): { byteLength: number; chunks: string[] } {
  if (!Number.isSafeInteger(maxRawBytes) || maxRawBytes < 1) throw new Error("maxRawBytes must be a positive integer");
  const bytes = encoder.encode(value);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += maxRawBytes) {
    chunks.push(bytesToBase64(bytes.subarray(offset, offset + maxRawBytes)));
  }
  return { byteLength: bytes.byteLength, chunks };
}

export function decodeUtf8Base64Chunks(chunks: string[], maxBytes = 8_388_608): string {
  let size = 0;
  const parts = chunks.map(chunk => {
    const binary = atob(chunk);
    size += binary.length;
    if (size > maxBytes) throw new Error("Raw payload exceeds read limit");
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  });
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
