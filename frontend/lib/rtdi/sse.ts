const encoder = new TextEncoder();

export function encodeSseEvent(input: { event: string; data: unknown; id?: number }): Uint8Array {
  const lines = JSON.stringify(input.data).split("\n").map(line => `data: ${line}`).join("\n");
  const id = input.id === undefined ? "" : `id: ${input.id}\n`;
  return encoder.encode(`${id}event: ${input.event}\n${lines}\n\n`);
}

export function parseEventCursor(value: string | null): number {
  if (!value) return 0;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
}
