"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ArrowRight, RefreshCw, Send } from "lucide-react";
import { knowledgeSources } from "@/lib/rtdi/local-knowledge";

export type ResponseLanguage = "en" | "zh-TW";
export function ReferenceSources({ ids }: { ids?: string[] }) {
  const sources = knowledgeSources.filter(source => ids?.includes(source.id));
  if (!sources.length) return null;
  return <div className="dc-local-sources">{sources.map(source => <details key={source.id}>
    <summary>Local reference · {source.title} [{source.id}]</summary>
    <p>{source.text}</p><small>{source.provenance}</small>
  </details>)}</div>;
}

const responseSchema = z.object({ answer: z.string().min(1), knowledge_sources: z.array(z.object({ id: z.string() })) });
type Message = { role: "user" | "assistant"; content: string; sourceIds?: string[] };

/** Separate general conversation: never sends the dashboard's selected run or history. */
export function SemiconductorChat({ enabled, language }: { enabled: boolean; language: ResponseLanguage }) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); pending.current = null; }, []);

  async function ask() {
    const text = question.trim();
    if (!enabled || !text || pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ mode: "openai", topic: "knowledge", language, question: text,
          history: messages.slice(-10).map(({ role, content }) => ({ role, content: content.slice(0, 5000) })) }),
      });
      const payload = await response.json();
      if (pending.current !== controller) return;
      if (!response.ok) throw new Error(z.object({ error: z.string() }).safeParse(payload).data?.error ?? "The assistant is unavailable.");
      const result = responseSchema.parse(payload);
      setMessages(previous => [...previous, { role: "user", content: text }, { role: "assistant", content: result.answer, sourceIds: result.knowledge_sources.map(source => source.id) }]);
      setQuestion("");
    } catch (failure) {
      if (pending.current === controller) setError(failure instanceof Error ? failure.message : "The assistant is unavailable.");
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  return <>
    <div className="dc-ai-context"><span>Context</span><strong>Semiconductor concepts · Local references</strong></div>
    <div className="dc-chat" aria-live="polite">
      {!messages.length && <div className="dc-ai-welcome"><span className="dc-notebook-label">SEMICONDUCTOR Q&A</span>
        <h3>Understand the test and the analysis</h3><p>Ask about wafer testing, yield, site differences, statistics or our analysis methods. For results from a specific wafer, use Selected analysis.</p>
        <div className="dc-draft-label">Try a question <span>Draft only</span></div>
        {["What is the difference between a wafer, die and test site?", "How do mean drift and increased spread differ?", "How do our stage predictions avoid data leakage?"].map(text =>
          <button key={text} disabled={!enabled || busy} onClick={() => { setQuestion(text); document.getElementById("knowledge-question")?.focus(); }}>{text}<ArrowRight size={14}/></button>)}
      </div>}
      {messages.map((message, index) => <div className={`dc-chat-message ${message.role}`} key={index}>
        <small>{message.role === "user" ? "QUESTION" : "EXPLANATION"}</small>
        <div className="dc-answer" style={{ whiteSpace: "pre-wrap" }}>{message.content}</div>
        <ReferenceSources ids={message.sourceIds}/>
      </div>)}
      {busy && <div className="dc-thinking"><RefreshCw size={15}/>Preparing an explanation from local references…</div>}
    </div>
    {error && <div className="dc-error" role="alert">{error}</div>}
    <form className="dc-composer" onSubmit={event => { event.preventDefault(); void ask(); }}>
      <textarea id="knowledge-question" aria-label="Semiconductor question" placeholder="Ask about semiconductor testing or analysis methods…" value={question} onChange={event => setQuestion(event.target.value)} maxLength={2000} disabled={!enabled || busy}/>
      <div><span>No web search · Model API required</span><button className="dc-primary" disabled={!enabled || busy || !question.trim()}><Send size={15}/>Submit</button></div>
    </form>
    <p className="dc-ai-foot">Educational guidance from bundled reference notes. This conversation does not access the selected run. History stays in this page session.</p>
  </>;
}
