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
