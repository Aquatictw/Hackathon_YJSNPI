export type TourRoute = '/workspace' | '/replay' | '/sandbox';
export type TourSource = 'workspace-backend' | 'workspace-summary' | 'replay-backend' | 'replay-archive';
export type TourStep = {
  id: string; route: TourRoute; chapter: string; title: string; body: string;
  target: string; tab?: string; detail?: string; source?: TourSource;
  preview?: {label: string; rows: [string, string][]};
};

export const tourWelcome = 'Choose a chapter, or start with Replay analysis and continue through Run workspace and Sandbox. Steps follow the current source without changing your data.';

export const tourChapters = [
  {
    "route": "/replay",
    "name": "Replay analysis",
    "description": "Offline archive or stored Gemini run analysis"
  },
  {
    "route": "/workspace",
    "name": "Run workspace",
    "description": "Load a scope, review records and investigate"
  },
  {
    "route": "/sandbox",
    "name": "Sandbox",
    "description": "Four synthetic practice examples and batch tools"
  }
] as const;

export const tourSteps: TourStep[] = [
  {
    "id": "analysis-load",
    "route": "/replay",
    "chapter": "Replay analysis",
    "target": ".dc-run-picker",
    "title": "Choose a summary or Gemini run, then Load",
    "body": "Use this same picker to choose a source, then press Load. Replay groups recorded Gemini runs, imported replays including training, and bundled summary.json. Live groups the two stored live-source scopes; their labels do not prove current machine activity. The page defaults to the offline 25-wafer archive. The guide follows the loaded source and never changes the source or loads data.",
  },
  {
    "id": "analysis-status",
    "route": "/replay",
    "chapter": "Replay analysis",
    "target": ".dc-loaded-run",
    "title": "Check provenance before interpreting updates",
    "body": "Confirm the loaded run, tester and original last source event timestamp. Read the source mode and backend connection separately: a stored live label or connected SSE does not prove current machine activity. Recorded captures retain their historical timestamps.",
    "source": "replay-backend"
  },
  {
    "id": "analysis-wafers",
    "route": "/replay",
    "chapter": "Replay analysis",
    "target": ".analysis-wafer-grid",
    "title": "Choose a wafer in the overview",
    "body": "Each wafer button represents a lot and wafer in the loaded run. Close the guide to select a wafer and update its summary and 3D yield view. Missing wafer identity stays unknown; no recorded alert does not establish normal operation.",
    "source": "replay-backend"
  },
  {
    "id": "analysis-wafer-detail",
    "route": "/replay",
    "chapter": "Replay analysis",
    "target": ".analysis-wafer-detail",
    "title": "Read the selected wafer summary",
    "body": "Review the selected wafer’s alert, prediction and matched-actual counts with its original last source event timestamp. Yield and completed-device count appear only when supplied for that wafer; missing values remain unavailable and are not inferred from prediction counts.",
    "source": "replay-backend"
  },
  {
    "id": "analysis-wafer-scene",
    "route": "/replay",
    "chapter": "Replay analysis",
    "target": ".wafer-scene",
    "title": "Interpret the 3D yield illustration",
    "body": "The 3D wafer illustrates the selected wafer’s supplied yield and fail share. Its die positions are illustrative, not measured defect coordinates. Missing yield remains unavailable; rotation and top-view controls change only the illustration.",
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
    "id": "analysis-workspace",
    "route": "/replay",
    "chapter": "Replay analysis",
    "title": "Open Workspace for individual records",
    "target": ".run-analysis-workspace-link",
    "body": "Close the guide, then choose Open this run in workspace to investigate individual evidence records, site series and temperature predictions with matched actuals. The link carries the loaded run and tester to Workspace; select the relevant record there.",
    "detail": "Next continues the guide in Run workspace without selecting a record. To investigate now, close the guide and use this link. Sandbox follows the Workspace chapter.",
    "source": "replay-backend"
  },
  {
    "id": "archive-source",
    "route": "/replay",
    "chapter": "Replay analysis",
    "target": ".replay-source",
    "title": "Read the offline archive source",
    "body": "The bundled summary.json contains 25 wafers from historical replay. Its results do not establish a live tester connection or tester receipt. To inspect a stored Gemini run, close the guide, select it in the same picker and press Load.",
    "source": "replay-archive"
  },
  {
    "id": "archive-wafers",
    "route": "/replay",
    "chapter": "Replay analysis",
    "target": ".wafer-tiles",
    "tab": ".replay-tabs [role='tab'][id$='-trigger-analysis']",
    "title": "Explore the archive wafers",
    "body": "Close the guide to filter or select a wafer. Each tile shows its source wafer ID, cumulative yield and alert count. No recorded alert does not establish normal operation; tile positions are not physical die locations.",
    "source": "replay-archive"
  },
  {
    "id": "archive-detail",
    "route": "/replay",
    "chapter": "Replay analysis",
    "target": ".replay-detail",
    "tab": ".replay-tabs [role='tab'][id$='-trigger-analysis']",
    "title": "Read archive alerts and site evidence",
    "body": "Read the selected wafer’s yield, evaluation label and recorded alerts. Labels are evaluation references, not detector rules. Detector scores are not probabilities; site traces use sample or completed-device order, not time.",
    "source": "replay-archive"
  },
  {
    "id": "archive-validation",
    "route": "/replay",
    "chapter": "Replay analysis",
    "target": ".model-panel",
    "tab": ".replay-tabs [role='tab'][id$='-trigger-validation']",
    "title": "Review model validation",
    "body": "Compare MAE, RMSE, worst error, baseline error and evaluation sample counts. These reused development wafers do not provide independent validation or prove live accuracy, latency or tester receipt. Full feature coverage does not mean perfect predictions.",
    "source": "replay-archive"
  },
  {
    "id": "archive-limitations",
    "route": "/replay",
    "chapter": "Replay analysis",
    "target": ".limitations-panel",
    "tab": ".replay-tabs [role='tab'][id$='-trigger-limitations']",
    "title": "Read the archive limitations",
    "body": "Read the limitations and live_integration value as supplied by the source report. Missing measurements, individual prediction records and tester receipts cannot be recovered from summary totals. The guide leaves the historical artifact unchanged.",
    "source": "replay-archive"
  },
  {
    "id": "archive-workspace",
    "route": "/replay",
    "chapter": "Replay analysis",
    "target": ".replay-tabs",
    "title": "Continue to Run workspace",
    "body": "Next continues the guide in Run workspace, followed by Sandbox. Workspace follows its own saved source; this navigation does not load the archive or a Gemini run into it. To investigate a stored Gemini run, close the guide, select it in the picker, press Load and use Open this run in workspace.",
    "source": "replay-archive"
  },
  {
    "id": "workspace",
    "route": "/workspace",
    "chapter": "Run workspace",
    "target": ".dc-heading",
    "title": "Investigate records in Run workspace",
    "body": "After the Replay analysis overview, use Run workspace for individual records and the assistant. Confirm the source and loaded run before investigating. Sandbox follows for synthetic practice.",
    "detail": "The guide changes display tabs only. It never loads runs, switches sources, imports files, loads practice examples or submits questions. Close it before using those controls."
  },
  {
    "id": "load",
    "route": "/workspace",
    "chapter": "Run workspace",
    "target": ".dc-run-picker",
    "title": "Choose a source, then Load",
    "body": "Choose bundled summary.json or a stored Tester ID / Run ID pair, then Load. Replay includes recorded Gemini captures and imported replay records, including training; Live groups stored live-source runs and does not prove current machine activity. You can refresh the list or enter IDs manually. Selection details describes the pending choice; selecting an option alone does not load it.",
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

// Inspect the rendered source, never a pending picker value or saved backend scope.
export function tourSource(path: string, hasElement: (selector: string) => boolean): TourSource | null {
  const route = tourRoute(path);
  if (route === '/replay') {
    if (hasElement('.replay-source')) return 'replay-archive';
    return hasElement('.run-analysis') ? 'replay-backend' : null;
  }
  if (route === '/workspace') return hasElement('.isw-app') ? 'workspace-summary' : 'workspace-backend';
  return null;
}
