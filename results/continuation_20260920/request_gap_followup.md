# Missing request follow-up

Recorded September 20, 2026 (Taipei). This is a source investigation and browser SSH observation, not a downloaded raw capture or a new machine run.

The retained fresh run `3f46468325ac47de894e6a13d3c672e0` was rechecked on `group-6`. Filtering every line of `receipt_run/current.jsonl` for both `request_error` and `callback_error` returned an empty list. The earlier continuous sequence and 119 requests / 476 actual joins remain unchanged.

Read-only delegated source review established that `Main.flow` invokes stage 1 unconditionally before sensor 1. `Predict.java` calls the unavailable vendor `FetchAction`, logs the resulting collection, and executes only a nonempty collection. This explains the empty `Actions =>` and absent execution, but a zero-length collection does not distinguish a blank transport response from a swallowed vendor error. Python logs `prediction_request` after native `get()` completes. Production-message FIFO writing occurs after the collection check, so that write cannot directly explain the empty collection in this call.

The preceding production action is 79.298 ms before touchdown 9 starts. That proximity does not establish overlap or causation. The observed 3 ms processing time does not establish timeout units. No source evidence supports claiming that `get_prod` drains prediction actions.

Root cause remains at the vendor FetchAction / Nexus routing / native callback boundary. A future diagnosis should correlate sent request, transport status, response byte count and callback entry; automatic retry is not justified without correlation because it could duplicate a late action. No runtime change or retry was introduced for this gap.

Separately, the host performed a TLS-validated HTTP HEAD request to the public preview's `/api/config` and received response headers on September 19 at 18:29:03 UTC. This establishes host-to-preview HTTPS reachability only: no event ingest, credential, native Edge egress or durable transport claim follows.
