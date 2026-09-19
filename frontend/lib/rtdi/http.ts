export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

type JsonBodyLimits = {
  maxCompressedBytes: number;
  maxDecompressedBytes: number;
  allowGzip?: boolean;
};

async function readBytes(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpInputError(413, "請求內容超過大小限制。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function readJsonBody(request: Request, limits: number | JsonBodyLimits): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new HttpInputError(415, "需要 JSON 格式。");
  if (!request.body) throw new HttpInputError(400, "請求內容不可為空。");
  const options = typeof limits === "number"
    ? { maxCompressedBytes: limits, maxDecompressedBytes: limits, allowGzip: false }
    : limits;
  const encoding = request.headers.get("content-encoding")?.trim().toLowerCase() || "identity";
  if (encoding !== "identity" && encoding !== "gzip") throw new HttpInputError(415, "不支援此 Content-Encoding。");
  if (encoding === "gzip" && !options.allowGzip) throw new HttpInputError(415, "此入口不接受 gzip 內容。");
  const compressed = await readBytes(request.body, options.maxCompressedBytes);
  let bytes = compressed;
  if (encoding === "gzip") {
    try {
      const source = new Response(new Uint8Array(compressed).buffer).body;
      if (!source) throw new Error("missing gzip stream");
      bytes = await readBytes(source.pipeThrough(new DecompressionStream("gzip")), options.maxDecompressedBytes);
    } catch (error) {
      if (error instanceof HttpInputError) throw error;
      throw new HttpInputError(400, "gzip 內容損壞或無法解壓縮。");
    }
  }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new HttpInputError(400, "JSON 格式錯誤。"); }
}

export class HttpInputError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function sameOrigin(request: Request, publicOrigin = ""): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === new URL(request.url).origin) return true;
  // Explicit server configuration only; forwarded headers are client-controlled.
  try {
    const trusted = new URL(publicOrigin);
    return ["http:", "https:"].includes(trusted.protocol)
      && publicOrigin === trusted.origin && origin === trusted.origin;
  } catch { return false; }
}

export function bearerMatches(request: Request, expected: string): boolean {
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}
