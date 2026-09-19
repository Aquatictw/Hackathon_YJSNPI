export type TourRoute = '/workspace' | '/replay' | '/sandbox';
export type TourSource = 'workspace-backend' | 'workspace-summary' | 'replay-backend' | 'replay-archive';
export type TourStep = {
  id: string; route: TourRoute; chapter: string; title: string; body: string;
  target: string; tab?: string; detail?: string; source?: TourSource;
  preview?: {label: string; rows: [string, string][]};
};

export const tourChapters = [
  {
    "route": "/workspace",
    "name": "Run workspace",
    "description": "Load a scope, review records and investigate"
  },
  {
    "route": "/replay",
    "name": "Replay analysis",
    "description": "Backend snapshot/SSE or offline JSON archive"
  },
  {
    "route": "/sandbox",
    "name": "Sandbox",
    "description": "Four synthetic practice examples and batch tools"
  }
] as const;

export const tourSteps: TourStep[] = [
  {
    "id": "workspace",
    "route": "/workspace",
    "chapter": "Run workspace",
    "target": ".dc-heading",
    "title": "Start with Run workspace",
    "body": "Home opens Run workspace. First confirm the source, then load a run, review records and use the assistant. Replay analysis and Sandbox follow in that order.",
    "detail": "The guide changes display tabs only. It never loads runs, switches sources, imports files, loads practice examples or submits questions. Close it before using those controls."
  },
  {
    "id": "load",
    "route": "/workspace",
    "chapter": "Run workspace",
    "target": ".dc-run-picker",
    "title": "Choose a stored run, then Load",
    "body": "Choose a stored Tester ID / Run ID pair, refresh the list or enter IDs manually. Selection details describes the pending choice; the loaded run changes only after Load succeeds.",
    "detail": "An imported summary remains offline until you explicitly choose Load backend run. Switching to backend data retains the saved import in this browser tab."
  },
  {
    "id": "stream",
    "route": "/workspace",
    "chapter": "Run workspace",
    "target": ".dc-stream-status",
    "title": "Separate backend connection from machine freshness",
    "body": "Backend SSE reports the browser-to-backend connection only. Read the source mode and last source event time separately; a connected stream or a stored live label does not verify current Gemini telemetry.",
    "source": "workspace-backend"
  },
  {
    "id": "workspace-summary",
    "route": "/workspace",
    "chapter": "Run workspace",
    "target": ".dc-workspace-stats",
    "title": "Read the loaded run summary",
    "body": "Incidents, Evidence records and Temperature predictions are separate totals. Source-event and matched-actual counts provide context. The loaded identity and source time above belong to the snapshot, not an unsubmitted picker choice.",
    "source": "workspace-backend"
  },
  {
    "id": "evidence",
    "route": "/workspace",
    "chapter": "Run workspace",
    "title": "Search and select evidence",
    "target": ".dc-evidence-layout",
    "tab": "#tab-evidence",
    "body": "Search by wafer, test or category, then select a record. Compare observed value, baseline, threshold, site traces and the original source recommendation.",
    "detail": "Record identity and raw JSON expose provenance. Missing series remain unavailable. The guide does not change your search, selected incident or investigation draft.",
    "source": "workspace-backend"
  },
  {
    "id": "temperature",
    "route": "/workspace",
    "chapter": "Run workspace",
    "title": "Compare Temperature predictions and actuals",
    "target": ".dc-temperature",
    "tab": "#tab-predictions",
    "body": "Read predicted and uniquely matched actual values by stage and site. Difference is predicted minus actual. Missing or conflicting actuals do not become zero.",
    "detail": "Expand Device & provenance for request IDs, feature coverage and receipt status. Source units may be unconfirmed; no acceptance tolerance is assumed.",
    "preview": {
      "label": "Temperature comparison example",
      "rows": [
        [
          "Stage / site",
          "Stage 2 · Site 1"
        ],
        [
          "Predicted / actual",
          "42.3 / 41.8 · synthetic units"
        ],
        [
          "Difference",
          "+0.5 · no pass/fail claim"
        ]
      ]
    },
    "source": "workspace-backend"
  },
  {
    "id": "commands",
    "route": "/workspace",
    "chapter": "Run workspace",
    "title": "Distinguish queued commands from receipts",
    "target": ".dc-command-list",
    "tab": "#tab-commands",
    "body": "This view is read-only. Queued, edge received and queued to tester are different from tester confirmed. Rejected, failed and expired states remain meaningful outcomes.",
    "detail": "Even a displayed confirmation is a backend report requiring correlated evidence for live acceptance. The guide and investigation tools send no tester commands.",
    "source": "workspace-backend"
  },
  {
    "id": "investigate",
    "route": "/workspace",
    "chapter": "Run workspace",
    "target": ".dc-assistant-controls",
    "title": "Choose the assistant topic and response language",
    "body": "Selected analysis uses verified records from the loaded run, tester and selected incident. Semiconductor Q&A uses local concept notes without accessing the selected run. Response language applies to the next submitted question.",
    "source": "workspace-backend"
  },
  {
    "id": "cost",
    "route": "/workspace",
    "chapter": "Run workspace",
    "target": ".dc-ai",
    "title": "Review a draft before submitting",
    "body": "Question templates only fill a draft. Explicit submission calls the model API and can incur cost. Run investigations save answers and references through the service; general Q&A remains in page memory and is lost on reload or navigation.",
    "source": "workspace-backend",
    "detail": "The guide preserves the selected assistant topic and never edits or submits a draft. Model answers are advisory; they do not send tester commands or prove receipt."
  },
  {
    "id": "workspace-import",
    "route": "/workspace",
    "chapter": "Run workspace",
    "target": ".isw-source",
    "title": "Your imported summary stays offline",
    "body": "The filename identifies the saved browser-tab import. Its wafer selection, alerts, validation and limitations remain available without a backend snapshot or SSE connection.",
    "source": "workspace-summary"
  },
  {
    "id": "workspace-import-views",
    "route": "/workspace",
    "chapter": "Run workspace",
    "target": ".isw-tabs",
    "title": "Explore the summary views",
    "body": "Wafers & alerts, Model validation and Limitations describe this imported report. Individual temperature records, backend commands, receipts and selected-run model analysis are unavailable from a summary alone.",
    "source": "workspace-summary"
  },
  {
    "id": "analysis-source",
    "route": "/replay",
    "chapter": "Replay analysis",
    "target": ".run-analysis-source",
    "title": "Choose the analysis source first",
    "body": "Stored / live backend run reviews scoped snapshots and SSE updates. Offline JSON archive reviews bundled or imported summaries. This chapter follows your current choice and skips controls belonging to the other mode.",
    "detail": "To explore the other mode, close the guide, switch the analysis source, then reopen this chapter. The guide never changes the source for you."
  },
  {
    "id": "analysis-load",
    "route": "/replay",
    "chapter": "Replay analysis",
    "target": ".dc-run-picker",
    "title": "Load the backend scope for analysis",
    "body": "Choose a stored run or enter known IDs and explicitly Load. The backend analysis restores saved scope when available and refreshes records through snapshot/SSE; the guide does not initiate a load.",
    "source": "replay-backend"
  },
  {
    "id": "analysis-status",
    "route": "/replay",
    "chapter": "Replay analysis",
    "target": ".source-connection-notice",
    "title": "Check provenance before interpreting updates",
    "body": "Read source mode, backend connection and original event timestamps together. Recorded captures remain historical replay, even while backend SSE is connected. Missing or stale source records do not establish current machine health.",
    "source": "replay-backend"
  },
  {
    "id": "analysis-summary",
    "route": "/replay",
    "chapter": "Replay analysis",
    "target": ".dc-workspace-stats",
    "title": "Compare backend record totals",
    "body": "Review incidents, evidence records, predictions and matched actuals for the loaded run. After a snapshot loads, the lot/wafer context includes Open this run in workspace for the same run and tester.",
    "source": "replay-backend"
  },
  {
    "id": "analysis-evidence",
    "route": "/replay",
    "chapter": "Replay analysis",
    "target": ".run-analysis-evidence",
    "title": "Inspect backend evidence and site series",
    "body": "Select a record to inspect its source message, event time, site traces and raw identity. Charts use completed-device order within each site, not elapsed time. A chart is unavailable when the source supplies no sequence.",
    "source": "replay-backend"
  },
  {
    "id": "analysis-coverage",
    "route": "/replay",
    "chapter": "Replay analysis",
    "target": ".run-analysis-coverage",
    "title": "Keep yield and measurement coverage scoped",
    "body": "Yield is shown per supplied record; no combined run yield is inferred. Missing yield stays unavailable. Normalized measurement counts do not establish complete raw measurement coverage.",
    "source": "replay-backend"
  },
  {
    "id": "analysis-temperature",
    "route": "/replay",
    "chapter": "Replay analysis",
    "title": "Compare Temperature predictions and actuals",
    "target": ".run-analysis-temperature",
    "body": "Read predicted and uniquely matched actual values by stage and site. Difference is predicted minus actual. Missing or conflicting actuals do not become zero.",
    "detail": "Expand Device & provenance for request IDs, feature coverage and receipt status. Source units may be unconfirmed; no acceptance tolerance is assumed.",
    "preview": {
      "label": "Temperature comparison example",
      "rows": [
        [
          "Stage / site",
          "Stage 2 · Site 1"
        ],
        [
          "Predicted / actual",
          "42.3 / 41.8 · synthetic units"
        ],
        [
          "Difference",
          "+0.5 · no pass/fail claim"
        ]
      ]
    },
    "source": "replay-backend"
  },
  {
    "id": "overview",
    "route": "/replay",
    "chapter": "Replay analysis",
    "title": "Read the source before the result",
    "target": ".replay-archive-notice",
    "body": "Replay analysis reviews historical evidence. It does not establish a live tester connection or confirm receipt of a command.",
    "detail": "This is the offline archive. Use the source selector to return to backend analysis after closing the guide. Imported files stay in this browser tab and are not uploaded.",
    "source": "replay-archive"
  },
  {
    "id": "import",
    "route": "/replay",
    "chapter": "Replay analysis",
    "title": "Import a different replay summary",
    "target": ".replay-actions, .replay-source",
    "body": "Import summary accepts replay JSON up to 5 MiB and validates it in browser memory. It does not upload the file or request AI analysis.",
    "detail": "Your imported summary and selection stay in this browser tab across pages and reloads. Use bundled example explicitly replaces the import. Invalid imports retain the previous dataset. The guide never changes the source.",
    "source": "replay-archive"
  },
  {
    "id": "totals",
    "route": "/replay",
    "chapter": "Replay analysis",
    "title": "Understand the summary",
    "target": ".replay-overview .stats",
    "body": "Dataset size, recorded alerts and alerted wafers describe the loaded summary. Tester receipt remains unverified unless supported by source evidence.",
    "detail": "The animated wafer is an illustration, not a spatial wafer map. Its controls change the illustration only.",
    "source": "replay-archive"
  },
  {
    "id": "filter",
    "route": "/replay",
    "chapter": "Replay analysis",
    "title": "Filter the wafer list",
    "target": ".wafer-panel select",
    "tab": ".replay-tabs [role=\"tab\"][id$=\"-trigger-analysis\"]",
    "body": "Choose All, With alerts or No alerts to narrow the list. No recorded alert does not establish normal operation. Filtering can change the selected wafer if it leaves the filtered set.",
    "source": "replay-archive"
  },
  {
    "id": "wafer",
    "route": "/replay",
    "chapter": "Replay analysis",
    "title": "Select a wafer and read its yield",
    "target": ".wafer-tiles",
    "tab": ".replay-tabs [role=\"tab\"][id$=\"-trigger-analysis\"]",
    "body": "Each tile shows its source wafer ID, cumulative yield and alert count. Select a tile or use Next wafer to inspect another wafer in the current filter.",
    "detail": "Yield is shown as a percentage. Tiles follow source order; their positions do not represent physical die locations.",
    "source": "replay-archive"
  },
  {
    "id": "yield",
    "route": "/replay",
    "chapter": "Replay analysis",
    "title": "Separate evaluation labels from observations",
    "target": ".wafer-summary",
    "tab": ".replay-tabs [role=\"tab\"][id$=\"-trigger-analysis\"]",
    "body": "Cumulative yield describes completed devices. The dataset label is an evaluation reference, not a detector rule. Review any missed-detection note even when the alert count is zero.",
    "source": "replay-archive"
  },
  {
    "id": "alerts",
    "route": "/replay",
    "chapter": "Replay analysis",
    "title": "Inspect each recorded alert",
    "target": ".alert-selector",
    "tab": ".replay-tabs [role=\"tab\"][id$=\"-trigger-analysis\"]",
    "body": "A wafer can contain several alerts. The alert selector opens the corresponding observed value, reference, detector score and site evidence. A detector score is not a probability.",
    "preview": {
      "label": "Alert reading example",
      "rows": [
        [
          "Observed / reference",
          "2.60 / 1.12 · synthetic values"
        ],
        [
          "Detector score",
          "5.43 · not a probability"
        ]
      ]
    },
    "source": "replay-archive"
  },
  {
    "id": "series",
    "route": "/replay",
    "chapter": "Replay analysis",
    "title": "Compare the measurement sequences",
    "target": ".replay-plot",
    "tab": ".replay-tabs [role=\"tab\"][id$=\"-trigger-analysis\"]",
    "body": "Compare site traces and their reference. The horizontal axis is sample or completed-device order, not time. Raw units remain unverified unless supplied by the source.",
    "detail": "Source guidance is detector text, not an LLM answer. Copy handoff and source fields preserve the local wafer/alert reference; it is not a backend event ID.",
    "source": "replay-archive"
  },
  {
    "id": "validation",
    "route": "/replay",
    "chapter": "Replay analysis",
    "title": "Review model validation",
    "target": ".model-panel",
    "tab": ".replay-tabs [role=\"tab\"][id$=\"-trigger-validation\"]",
    "body": "Compare prediction error metrics with the baseline and inspect the evaluation sample count. MAE, RMSE and worst error answer different questions about error magnitude.",
    "detail": "Dataset validation is not proof of live accuracy, latency or tester receipt. Full feature coverage does not mean perfect predictions.",
    "source": "replay-archive"
  },
  {
    "id": "limitations",
    "route": "/replay",
    "chapter": "Replay analysis",
    "title": "Read the dataset source fields",
    "target": ".limitations-panel",
    "tab": ".replay-tabs [role=\"tab\"][id$=\"-trigger-limitations\"]",
    "body": "This panel shows the report’s limitations and live_integration value exactly as supplied.",
    "detail": "These statements belong to the source report. Next opens Sandbox for synthetic practice; it does not load a practice example.",
    "source": "replay-archive"
  },
  {
    "id": "sandbox",
    "route": "/sandbox",
    "chapter": "Sandbox",
    "title": "Experiment with explicitly synthetic data",
    "target": ".simulation-banner",
    "body": "Sandbox fixtures are synthetic and have no live tester connection. They demonstrate event handling, evidence and response semantics without proving machine performance.",
    "detail": "This guide does not receive a fixture or alter an existing sandbox workspace."
  },
  {
    "id": "practice",
    "route": "/sandbox",
    "chapter": "Sandbox",
    "target": "section[aria-labelledby=\"practice-title\"]",
    "title": "Choose one of four practice examples",
    "body": "Healthy window, Site imbalance, Mean drift and Missing / late prediction data demonstrate different evidence patterns. Load practice example adds a local synthetic event and selects rule-based mode without a model request."
  },
  {
    "id": "practice-late",
    "route": "/sandbox",
    "chapter": "Sandbox",
    "target": ".ai-panel",
    "title": "Practice late actuals and draft questions",
    "body": "After loading an example, selected practice guidance offers draft questions. In Missing / late prediction data, Receive late stage 6 actual joins the synthetic actual; stage 3 remains unavailable. The guide never loads an example or receives data."
  },
  {
    "id": "sandbox-evidence",
    "route": "/sandbox",
    "chapter": "Sandbox",
    "title": "Inspect events, predictions and JSON",
    "target": ".event-tabs",
    "tab": ".event-tabs [role=\"tab\"][id$=\"-trigger-evidence\"]",
    "body": "Event analysis presents source evidence. Temperature predictions separate predictions from actuals. Message JSON accepts supported batches with validation and deduplication.",
    "detail": "A valid batch is not proof of physical units or tester receipt. Reset workspace clears local data only; the guide never invokes it."
  },
  {
    "id": "sandbox-temperature",
    "route": "/sandbox",
    "chapter": "Sandbox",
    "target": ".event-tabs",
    "title": "Inspect prediction gaps and actuals",
    "body": "Temperature predictions separates predicted values, actuals and missing inputs. A late actual must match its request, device, site and stage; it does not establish on-time delivery or tester receipt.",
    "tab": ".event-tabs [role=\"tab\"][id$=\"-trigger-predictions\"]"
  },
  {
    "id": "fixtures",
    "route": "/sandbox",
    "chapter": "Sandbox",
    "title": "Use additional fixture and batch controls",
    "target": ".receive-controls",
    "body": "The separate fixture controls offer Mean shift, Normal fixture, Missing data and Repeat previous batch for deduplication. Message JSON validates supported batches. Reset workspace clears local events, answers and drafts only.",
    "preview": {
      "label": "Fixture example",
      "rows": [
        [
          "Scenario",
          "Synthetic mean shift"
        ],
        [
          "Receipt",
          "Not supplied · no tester connection"
        ]
      ]
    }
  },
  {
    "id": "rule-demo",
    "route": "/sandbox",
    "chapter": "Sandbox",
    "title": "Distinguish rule-based and model analysis",
    "target": ".ai-toolbar",
    "body": "Rule-based analysis uses predefined responses and makes no model API call. OpenAI API mode sends the selected event and that mode’s conversation when you explicitly submit.",
    "detail": "The guide never changes the response mode or sends a request. An unavailable OpenAI service does not silently turn an API response into a rule-based answer."
  },
  {
    "id": "finish",
    "route": "/sandbox",
    "chapter": "Sandbox",
    "title": "Continue with the evidence",
    "target": ".composer",
    "body": "Select a question to draft it, review the context, and submit only when intended. Source claims, model suggestions and confirmed tester receipts remain distinct.",
    "detail": "Finish closes the guide and returns keyboard focus to Guide. You can reopen any chapter from the shared header."
  }
];

export function tourRoute(path: string): TourRoute | null {
  const clean = path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path;
  return clean === '/' ? '/workspace' : clean === '/replay' || clean === '/workspace' || clean === '/sandbox' ? clean : null;
}

// Resolve the destination source after native navigation, starting at its neutral intro.
export function tourIndices(path: string, source: TourSource | null): number[] {
  const route = tourRoute(path);
  return tourSteps.flatMap((step, index) => step.route !== route || !step.source || step.source === source ? [index] : []);
}
