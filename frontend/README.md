# RTDI Insight — grp6 本機前端原型

目前只做本機原型，不部署。資料與示範溫度完全自造；不讀競賽 CSV，不修改 `grp6_app` 或機台，不發送 command。

## 執行

Node.js 22.18+（此機已使用 24.15），依賴已鎖在 package-lock.json。

```bash
cd /Users/alan/Desktop/Hackathon_YJSNPI/frontend
npm ci
npm run dev -- --host 127.0.0.1
```

預設 http://localhost:5173 。可選正常、均值偏移、缺資料、重送情境，或在 Message JSON 貼入 batch。事件保存在目前分頁記憶體，重新整理即清除；這不是已串接的 live 系統。

## OpenAI

本原型提供兩種明確分開的模式：

- **示範解讀**：本機固定規則，沒有 LLM 推理、不呼叫 OpenAI。
- **OpenAI**：瀏覽器 POST `/api/assistant` → 伺服器呼叫 OpenAI Responses API；只有按下問題／送出才呼叫。

複製 `.dev.vars.example` 為 `.dev.vars`，在本機編輯填入自己的 `OPENAI_API_KEY`，並設定帳號有權限使用的 `OPENAI_MODEL`。重啟 dev server，再重新整理頁面。Cloudflare/Vinext 本機 server 從 `.dev.vars` 讀取 secret；程式也支援伺服器 process environment。`.env.example` 供隊友移植 Node backend 時參考，並非瀏覽器設定。

**不要把 key 貼在聊天、前端程式、JSON message 或 NEXT_PUBLIC_/VITE_ 變數中。** `/api/config` 只回是否已設定，不會回傳金鑰。程式使用固定 `https://api.openai.com/v1/responses`、store:false、30 秒 timeout；失敗明確顯示，不暗中切換示範回答。兩種模式的對話記錄分開。

使用 OpenAI 時送出：目前事件、對應 evidence/incident/prediction 和最近 10 則該事件該模式對話。原型內建資料可直接測試；接正式資料前由團隊確認允許外送的內容。LLM 無任何機台操作工具。HTTP route 僅有本機用途的同源检查、輸入上限和單 process 速率限制；**不是公開服務的認證方案**。要部署必須由後端組加入使用者認證、團隊 scope、持久 rate limit 與用量管理。

實際 OpenAI 端到端測試需要有效 key、模型權限、帳戶額度；未提供 key 時不能聲稱已驗證模型回覆。

官方參考：https://developers.openai.com/api/docs/quickstart

## 交接

`contracts/README.md` 說明交付介面草案、fixture、HTTPS batch/polling/ACK 建議。
`lib/rtdi/contracts.ts` 負責接收驗證和去重；未來由 transport adapter 將後端事件送入同一入口。
`app/api/assistant/route.ts` 是前端示範用的薄代理，隊友可移植到既有後端，不必採用這個部署框架。

UI 上的機台回傳區永遠不會因 AI 回答而自動標成已收到。只有後續接上已驗證的 command/ACK/receipt 才能更新狀態。

## 驗證

```bash
npm test
npx tsc --noEmit
npm run build
```

建置基於 Vinext/React/TypeScript；本機 server 是 localhost:5173。可選 WebMCP 工具 `receive_rtdi_demo_batch` 只載入自造示範，不連外也不發送機台指令。
