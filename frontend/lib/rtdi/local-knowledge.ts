/** Bundled reference material. No runtime download, embedding service or search API. */
export const KNOWLEDGE_VERSION = "2026-09-19.1";
export type KnowledgeSource = { id: string; title: string; provenance: string; text: string };
export const knowledgeSources: readonly KnowledgeSource[] = [
  {
    id: "KB-fundamentals", title: "Wafer testing and terminology",
    provenance: "Locally authored educational primer; general semiconductor test concepts, not device specifications.",
    text: "A wafer is a semiconductor substrate containing many dies. A die is an individual circuit before or after separation. A lot groups material processed or tracked together. A DUT is the device under test. Wafer probing electrically contacts die pads before packaging; final test evaluates packaged devices. A tester applies stimuli and measures responses; a prober positions the wafer and probe contacts. A test site is a parallel test channel or device position in the test setup, not necessarily a wafer coordinate. Compare site channels separately from X/Y die locations. A touchdown is a probe contact operation that may test multiple dies. A test suite groups measurements; a pin identifies a signal or measurement connection. A test name alone does not establish its physical unit or electrical meaning.",
  },
  {
    id: "KB-yield", title: "Yield, bins and sample size",
    provenance: "Local educational synthesis; this application's bin convention is documented in SYSTEM.md, Requirements and architecture.",
    text: "Yield is passing completed devices divided by all completed devices in the stated population. Always state the denominator, lot/wafer/site scope and whether testing is complete. Soft bins classify outcomes in software; hard bins are equipment-handling categories whose mapping depends on the test program. In this dataset SBin 1 means PASS and SBin 2–32 means FAIL; do not generalize this mapping to other products. Early cumulative yield is uncertain, especially with few completed devices. A Wilson binomial interval reflects sampling uncertainty under its assumptions; correlated die outcomes may violate independent-trial assumptions. Low yield identifies an outcome, not its physical cause. An alert threshold is not a product specification or an automatic scrap decision.",
  },
  {
    id: "KB-statistics", title: "Mean shifts, spread and outliers",
    provenance: "Locally authored statistical primer; no external reference fetched for the demo.",
    text: "The mean describes average level; the median is the middle ordered value and is less sensitive to extreme observations. Variance measures squared dispersion and standard deviation has the original measurement units. A mean shift changes the center; spread increase changes variability. Spread decrease can indicate tighter behavior, clipping, rounding, saturation, changed sampling or a measurement problem; it is not automatically an improvement. One outlier can inflate a variance estimate. Mixing sites with different means can increase pooled variance without changing within-site noise. A window spanning a mean step can also look more variable than a later stable window. Compare equivalent tests, units, site populations and window sizes. Distinguish raw measurements, normalized scores and thresholds. A statistical anomaly is a deviation from a reference, not proof of failure or causality. Many simultaneous tests increase false-alarm opportunities, so isolated excursions need corroboration.",
  },
  {
    id: "KB-diagnosis", title: "Investigating site differences and possible causes",
    provenance: "Locally authored troubleshooting guidance; hypotheses require independent measurements.",
    text: "A site-specific change may be consistent with probe contact, channel calibration, fixtures or a site-specific device population. A common change across sites may be consistent with shared temperature, supply, instrumentation or material changes. These are hypotheses, not a diagnosis. Compare the same measurement and time/device window across sites; inspect contact resistance or continuity checks when available, calibration records, supply and temperature logs, wafer coordinates and retest behavior. Temperature can influence leakage, resistance and timing, but direction and magnitude are device-dependent. IDDQ commonly denotes quiescent supply current under defined conditions; unexpectedly high current can have multiple causes and requires the actual test conditions. Never prescribe an unverified voltage, temperature limit or production intervention. Suggest checks for an engineer to review; this assistant cannot operate equipment.",
  },
  {
    id: "KB-prediction", title: "How this application's stage predictions work",
    provenance: "SYSTEM.md, Requirements and architecture; grp6_app/predict.py and grp6_app/train.py. Local method description, not proof of the deployed model version.",
    text: "The project uses six stage-specific Ridge regression models for sensor targets sensor1_CP, sensor2_DS0, sensor3_IO4, sensor4_IO1, sensor5_IO2 and sensor6_IO3. Ridge is linear regression with coefficient regularization. Stage 1 uses eligible early-flow features; stages 2–6 may use features from completed subflows 1–5 respectively. Future sensor targets, final bins, pass/fail, total test time and wafer labels are excluded to avoid leakage. Up to 32 selected features are used per model. Feature selection, imputation and scaling are fitted on training folds; validation splits by wafer. A prediction estimates a target and is not an actual measurement. Missing features and coverage affect whether an estimate is available. MAE is average absolute error; RMSE weights larger errors more heavily. Neither is classification accuracy. Training or replay fit is not independent held-out performance. Physical sensor units remain unconfirmed unless supplied by the source; do not label values as degrees Celsius from the word temperature alone. Actuals must match run, tester, source, request and applicable device/site/stage/attempt identity; ambiguous joins must not be treated as confirmed pairs.",
  },
  {
    id: "KB-detection", title: "How to interpret this application's anomaly analysis",
    provenance: "SYSTEM.md, Requirements and architecture; grp6_app/detectors.py. Method context only; inspect selected-run evidence for actual outcomes.",
    text: "The analysis covers low yield, site imbalance, upward/downward mean drift and increased/decreased spread. The baseline detector combines per-test reference thresholds, related-suite agreement and persistence. The documented low-yield rule uses completed devices, at least 32 samples and an 80% threshold, with a one-sided 95% Wilson upper bound before wafer end. This is a project detection policy, not a universal acceptance limit. Baseline values and observed values must be interpreted with their recorded statistic and scale; a legacy mean field may contain a median. Local research candidates are not proof of deployed behavior. Never infer an anomaly from a wafer number, evaluation label, example or reference note. Consult the selected incident and its actual detector/evidence metadata. No alert may mean warm-up, missing data, insufficient sensitivity or no threshold crossing; it does not establish that all measurements are normal. Reduced burst frequency alone does not establish reduced noise variance.",
  },
  {
    id: "KB-evidence", title: "Sources, freshness and delivery status",
    provenance: "SYSTEM.md, Runtime invariants and Implemented local API and UI.",
    text: "Live, replay and simulation are different sources. Replay reuses recorded data; simulation is fabricated example data. Neither demonstrates current machine behavior. Always preserve source mode, measurement scope, data quality and freshness. Missing records do not imply normality. A partial measurement sample does not represent every test on the wafer. An AI explanation is advisory and cannot change predictions, alerts or equipment state. Backend queued, Edge received, queued to tester and tester confirmed are distinct states. Only a correlated tester receipt supports delivery confirmation; an API response, callback return or log arrival alone does not. The edge prediction and alert path does not wait for the website or language model. Reference notes describe concepts and methods; only retrieved run records support claims about the selected run.",
  },
];

export function localKnowledgePrompt(): string {
  return `LOCAL REFERENCE PACK ${KNOWLEDGE_VERSION}\nThese are educational/method references, never observations about the current run. Cite their exact IDs.\n` +
    knowledgeSources.map(source => `[${source.id}] ${source.title}\nProvenance: ${source.provenance}\n${source.text}`).join("\n\n");
}

export function citedKnowledge(answer: string): KnowledgeSource[] {
  return knowledgeSources.filter(source => answer.includes(`[${source.id}]`));
}
