# Edge ↔ 外部組介面草案 v0.1

狀態：**待雙方確認**。這份草案是前端整合起點，不代表現有 Edge 或後端已實作。

- `schemas.json`：JSON Schema (Draft 2020-12)，定義 event、prediction、evidence、incident、command、command_ack、batch。
- `examples/normal.json`、`anomaly.json`、`missing.json`、`duplicate.json`：完全自造的示範資料。duplicate 與 anomaly 使用完全相同的 batch_id／record IDs，用於重送測試。
- `../lib/rtdi/contracts.ts`：前端及 AI 入口使用的執行期驗證；另有機台回執及 expiry 語意檢查。
- 所有記錄帶 run/tester 身分；與 site 有關的資料同時帶 lot/wafer/site。不可跨 run 或 site 合併。時間採有時區的 ISO 8601。
- sample unit `a.u.` 與 `°C (示範)` 不是實際 SDK 單位確認。`observed` 在範例 mean metric 中是 series 的算術平均。

## 開發交接

Edge 組提供 schema、四種 fixture 與版本；外部組驗證接收、去重、缺資料和 ACK 顯示。前端可在「Message JSON」貼上 batch，或由未來 transport adapter 呼叫：

```js
window.dispatchEvent(new CustomEvent('rtdi:batch', { detail: batch }));
```

此事件只更新目前瀏覽器的本地記憶體，不上傳、不持久化，不是 HTTPS ingest endpoint。最多保留最近 100 個 batch，重新整理即清除。API/schema 定案後只需在 adapter 轉換，UI 不直接讀 ONEAPI。

## HTTPS 行為建議（未實作，需外部組確認）

### POST /api/v1/events/batch

- body：`batch`，最多 100 records、256 KiB。服務端驗證完整 batch，寫入 durable storage 後才回 200。
- 認證：建議 `Authorization: Bearer <scoped_ingest_token>`，由外部組提供。不能把 token 放在前端。
- 唯一鍵建議 `(run_id, tester_id, record_id)`；`batch_id` 作為批次重試的 idempotency key。同 ID 同內容回 duplicate；同 ID 異內容回 409。
- 範例回應：`{"batch_id":"demo-batch-anomaly-1","accepted":9,"duplicates":0,"status":"stored"}`。accepted/duplicates 計算 records，不是 event 數。
- 400/422：schema 錯誤，保留在 outbox 並標記需修正，不盲目重送；401/403：停止重試並修復認證；409：ID 衝突需人工處理；413：拆小批；429/5xx/網路錯誤：依 Retry-After 或指數退避＋jitter，沿用 record IDs，不丟失 outbox。

### GET /api/v1/edge/commands?edge_id=...&after=...

- Edge 主動 polling；後端將認證 token 綁定允許的 tester/run，不能只信任 query 參數。
- 回應：`{"commands":[command],"next_cursor":"...","poll_after_ms":3000}`。
- 後端 queued 不表示 Edge 收到；可能重複投遞。Edge 以 command_id 去重，驗證 run/tester/expiry，執行前保存狀態。
- 過期、錯誤 run 或不支援的命令不得執行。

### POST /api/v1/commands/{command_id}/result

- body：`command_ack`；持久保存 ack 後回 200，ack_id 去重。
- `edge_received` → `edge_executed` → `tester_confirmed` 是不同狀態。`failed`／`expired` 另記原因。
- `tester_confirmed` 必須附 `tester_receipt_id`，且後端需要核對真實 tester log/回執；單靠 ID 格式合法不足以證明收到。
- ActionManager.set_message 成功只代表 API 接受／排隊，不足以使用 tester_confirmed。
- AI 文字永遠不是 ACK。前端原型沒有建立、發送、執行 command 的功能；即使輸入 ACK fixture，也不直接點亮確認狀態，直到後端提供已驗證的 command/receipt 關聯。

## 外部組需要補齊

後端 base URL、實際 auth/token 發放方式、正式大小限制、錯誤及退避規則、polling cursor 規則、ACK endpoint、網站聚合格式。
網站聚合建議含 `run_id, mode, last_event_at, data_quality, device_count, yield, incidents, predictions, commands`；未提供值顯示未知，不填假數字。

正式部署前，Edge 組需從實際 container 驗證 HTTPS POST 到外部後端。若不可達，再共同選擇 Host Controller relay 或 Gemini 內部後端；這個前端原型沒有測試或變更任何機台網路。

## message.txt 對照與 E 組的邊界

提供的 message.txt 是架構範例，不是已確認的完整 API 契約。前端 `0.1-draft` 是畫面內部格式，**不要求 Edge 改成這套格式**。`lib/rtdi/edge-adapter.ts` 支援其 `schema_version: 1, edge_id, batch_id, events` envelope，將 `site_id/source_mode/timestamp/prediction/current_value` 轉成畫面欄位。

目前支援 measurement、prediction、prediction_actual、evidence、heartbeat、run_summary。JSON receiver 接受此格式；可用 `examples/edge-v1-batch.json` 試用。未提供的 lot/wafer/unit 顯示「未提供／未確認」；沒有數列不繪圖；沒有 coverage、ACK 不推定完整或已回傳。多 site evidence 保留在訊息描述，待 D 提供 site 級摘要後再支援比較。

`prediction_actual` 要帶 event_id/timestamp/run_id/tester_id/request_id（建議 site_id/device_id 也提供），並先收到唯一對應 prediction；只靠 request_id 的精簡範例不適合跨 run 關聯，前端會拒收。原型 IDs 需全域唯一，不接受同 event_id 不同內容。正式後端可採 scoped key，但在送到前端 adapter 時需轉成唯一 UI key。

目前 API 行為章節中的 accepted/duplicates 計數，以及 ack enum，是草案。message.txt 使用 accepted ID 陣列與 queued/fetched/applied/confirmed，需 D 決定正式回應；建議採 accepted/duplicates/rejected ID 陣列，Edge 才能精確清除 outbox。狀態對照：fetched=Edge received；applied=Edge executed；confirmed=驗證過的 tester receipt。前端不把收到 ACK 字串本身當成可信回執。

按五人分工：A 提供真實 SDK/機台傳輸，B 提供預測，C 提供異常證據，D 提供持久 API/LLM tools/認證/commands，E 消費這些資料並展示與驗收。本次只實作 E，附 `/api/assistant` 本機試接 OpenAI 的薄代理；沒有取代 D 的服務。
