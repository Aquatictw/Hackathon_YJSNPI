import { json } from "@/lib/rtdi/http";
import { AmbiguousScopeError, getRunEventUpdates, StorageUnavailableError } from "@/lib/rtdi/repository";
import { encodeSseEvent, parseEventCursor } from "@/lib/rtdi/sse";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const testerId = url.searchParams.get("tester_id");
  let cursor = parseEventCursor(request.headers.get("last-event-id") ?? url.searchParams.get("cursor"));
  try {
    const initial = await getRunEventUpdates(id, testerId, cursor);
    if (!initial) return json({ error: "找不到指定 run。" }, 404);
    let stopped = request.signal.aborted;
    let wake: (() => void) | undefined;
    const stop = () => { stopped = true; wake?.(); };
    request.signal.addEventListener("abort", stop, { once: true });
    const pause = () => new Promise<void>(resolve => {
      const timer = setTimeout(done, 1_000);
      function done() { clearTimeout(timer); wake = undefined; resolve(); }
      wake = done;
      if (stopped) done();
    });
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const startedAt = Date.now();
        let batch = initial;
        let lastHeartbeat = startedAt;
        controller.enqueue(encodeSseEvent({ event: "ready", data: { run_id: id, tester_id: initial.tester_id, cursor }, id: cursor }));
        try {
          while (!stopped && Date.now() - startedAt < 25_000) {
            for (const update of batch.updates) {
              cursor = update.cursor;
              controller.enqueue(encodeSseEvent({ event: "edge_event", data: update.event, id: cursor }));
            }
            if (batch.updates.length < 100) await pause();
            if (stopped) break;
            if (Date.now() - lastHeartbeat >= 10_000) {
              controller.enqueue(encodeSseEvent({ event: "heartbeat", data: { cursor }, id: cursor }));
              lastHeartbeat = Date.now();
            }
            if (stopped) break;
            const next = await getRunEventUpdates(id, initial.tester_id, cursor);
            if (!next) break;
            batch = next;
          }
        } catch {
          if (!stopped) {
            try { controller.enqueue(encodeSseEvent({ event: "stream_error", data: { message: "事件流暫時中斷，客戶端將重新連線。" }, id: cursor })); }
            catch { /* The client may have disconnected between the signal check and enqueue. */ }
          }
        } finally {
          stop();
          request.signal.removeEventListener("abort", stop);
          try { controller.close(); }
          catch { /* The stream was already canceled by the client. */ }
        }
      },
      cancel() { stop(); },
    });
    return new Response(stream, { headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    if (error instanceof AmbiguousScopeError) return json({ error: error.message }, 409);
    if (error instanceof StorageUnavailableError) return json({ error: "後端資料庫尚未啟用。" }, 503);
    return json({ error: "暫時無法建立事件流。" }, 503);
  }
}
