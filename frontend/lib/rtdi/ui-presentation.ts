import type {Replay} from './replay.ts';

/** Display precision only; original evidence remains available unchanged. */
export function displayNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'Not provided';
  if (value !== 0 && (Math.abs(value) < 0.0001 || Math.abs(value) >= 1e7)) return value.toExponential(3);
  return new Intl.NumberFormat('en-US', {maximumFractionDigits: 4}).format(value);
}
export function investigationAvailability(config: {openai_configured: boolean; backend_connected: boolean} | null, failed: boolean) {
  if (failed) return {enabled: false, title: 'Service check failed', message: 'Retry the service check. Loaded evidence and offline replay remain available.'};
  if (!config) return {enabled: false, title: 'Checking service', message: 'Checking investigation service availability.'};
  if (!config.backend_connected) return {enabled: false, title: 'Data service unavailable', message: 'The database connection needs attention. Offline replay remains available.'};
  if (!config.openai_configured) return {enabled: false, title: 'Investigation unavailable', message: 'The model service is not configured. Evidence browsing and rule-based sandbox analysis remain available.'};
  return {enabled: true, title: 'Investigation available', message: 'Submitting a question uses the model API. Completed answers and citations are stored by the service.'};
}
/** Evaluation is supplied metadata, never a wafer-number rule. */
export function waferEvaluation(wafer: Replay['wafers'][number]) {
  if (wafer.expected === 'normal') return null;
  return wafer.expected_first_device === null
    ? 'Source evaluation: expected category not detected. This is a recorded miss.'
    : `Source evaluation: expected category detected at device ${wafer.expected_first_device}.`;
}

export function replaySelection(wafers: Replay['wafers'], selected: string, filter: string) {
  const visible = wafers.filter(w => filter === 'all' || (w.alerts.length ? 'alert' : 'quiet') === filter);
  return visible.find(w => w.wafer === selected)?.wafer ?? visible[0]?.wafer ?? '';
}
