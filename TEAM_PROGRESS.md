# grp6 progress — September 19, 2026

**Current stage: deployed on grp6; debugging the first live tester run.**

- **Models:** Six temperature models trained using only measurements available before each request; validated with five wafer-separated folds.
- **Detection/report:** Site imbalance, low yield, mean drift and spread changes implemented, with HTML evidence report. VM replay detected the expected category on 6/7 labeled anomaly wafers; W25 spread decrease remains missed.
- **Tests:** 13 local tests pass; 8 runtime tests pass in both the VM image and remote code-server. VM replay completed.
- **Live integration:** App running; ONEAPI event/command connections established and tester acknowledgment observed. Full prediction and alert receipt remain unverified.
- **Blocker:** Live TestEnd callback fails because the SDK returns PartFlag as `"0x0"`, while our code expects decimal.
- **Next:** Fix flag parsing, expose evidence in logs, redeploy and verify all six prediction stages plus tester alert receipt; preserve logs and replay fallback.

## E — Frontend prototype v0.1 (local-only checkpoint)

- Implemented in `frontend/`: event/evidence dashboard, six-stage prediction table, JSON input, normal/anomaly/missing/duplicate synthetic scenarios, and chat UI.
- Includes clearly labeled rule-based demo answers and a server-only OpenAI Responses proxy. **No API key supplied; real OpenAI responses remain unverified.**
- Added draft schemas/fixtures plus a limited adapter for message.txt's v1 envelope. Internal `0.1-draft` is a view model, not a demand that Edge/backend adopt it.
- Current validation: 11 frontend contract tests, TypeScript and build pass; browser receive → evidence → demo answer flow verified. Missing OpenAI key returns explicit 503.
- **C owns anomaly algorithms/evidence; D owns durable backend, auth, LLM tools and command/ACK services.** No deployed machine behavior changed. AI text never means tester receipt.
- Ready for user to commit/push. Start with `frontend/HANDOFF.md`; no commit, push or deployment performed by this task.
