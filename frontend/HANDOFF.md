# E 組前端 v0.1 — C／D 並行交接

2026-09-19。**本機原型階段完成，停止擴充，尚未部署或連正式後端。**

## 現在能做什麼

- 四種自造情境：正常、均值偏移、缺少資料、重送。
- 事件清單、evidence 趨勢、六階段預測／實測與回覆狀態。
- JSON 接收、schema 驗證、event/batch 去重。
- 示範解讀（固定規則，清楚標示）與 OpenAI 對話 UI。
- OpenAI server proxy：key 不進前端；缺 key、逾時、上游錯誤有獨立提示。
- 提供 message.txt v1 envelope 的有限 adapter；不推定未知單位／coverage／ACK。

## 三人的交界

| 人員 | 下一步 | 主要檔案／資料 |
|---|---|---|
| C 異常分析 | 提供真實 evidence/incident 範例：kind/direction、site 範圍、baseline/current、樣本數、序號／時間、單位、趨勢序列、方法版本 | `contracts/examples/` 是自造參考；實際演算法仍由 C 負責 |
| D 後端／LLM | 定案 v1 schema，提供持久 ingest、前端查詢/SSE、認證、正式 AI route、commands/results | `contracts/README.md` 列待確認項；`app/api/assistant/route.ts` 僅供本機試接與移植 |
| E 前端 | 接 D 的事件流與已驗證狀態，接 C evidence，依回應更新 UI；暫停新增功能 | `app/page.tsx`、`lib/rtdi/edge-adapter.ts` |

**前端 `0.1-draft` 是內部 view model，並非強制 Edge/後端 API。** D 可沿 message.txt 的 `{schema_version:1,edge_id,batch_id,events}` 發展契約；E 在 adapter 處轉接。

## 本機啟動

```bash
cd frontend
npm ci
npm run dev -- --host 127.0.0.1
```

開啟 http://localhost:5173 。Node >=22.18；不需要 Python／Docker。

## OpenAI 交接

複製 `.dev.vars.example` 至 `.dev.vars`，在本機填 OPENAI_API_KEY／OPENAI_MODEL，重啟 server。不要 commit `.dev.vars`，也不要把 key 傳進瀏覽器。
目前未設定 key，因此**真實 OpenAI 呼叫尚未驗證**。正式多步工具調查不是 v0.1 功能，由 D 接 get_incident/compare_sites 等工具。

## 本階段驗證

- `npm test`：11 個測試通過（schema、重送、ID 衝突、scope、延後 evidence、receipt gate、缺資料、v1 prediction_actual 關聯）。
- `npx tsc --noEmit`：通過。
- `npm run build`：通過。
- HTTP：config 不含金鑰；示範 route 正常回覆；未設定 key 的真實模式回 503，不假裝 AI 回答。
- 瀏覽器：點選模擬接收、畫面出現 incident/evidence，示範問題成功顯示含 evidence ID 的解讀。
- WebMCP：接收示範工具已驗證合法 anomaly 呼叫；其餘互動以 UI 和邏輯測試驗證，未宣稱完整 WebMCP 驗收。

## 尚未完成／刻意留給整合階段

- 沒有 database、HTTPS ingest、SSE、完整 auth 或 Edge egress 驗證。
- 沒有機台 commands；AI 文字不會更新機台接收狀態。
- 前端記憶體只保留最近 100 個 batch；刷新清空，不是 durable 去重或資料庫。
- v1 adapter 只支援文件列出的六種 record；command/incident 的正式 wire schema 需 D 定案。
- 真實資料與模型單位、機台回執要由 A/B/C/D 提供驗證。
- 前端 prototype API 有基本限制但不是可公開上線的安全／認證設計。
