import { z } from 'zod';
import { replaySchema, type Replay } from './replay.ts';

export const sourceSessionKey = 'rtdi.source-session.v1';
export type ReplayView = 'bundled' | 'imported' | 'backend';
export type ReplaySelection = { waferId: string; alertIndex: number; filter: string; tab: string; detailOpen: boolean };
export type SourceSession = { version: 1; mode: 'summary' | 'backend'; replayView?: ReplayView; replay?: { data: Replay; filename: string; selection: ReplaySelection } };
const selectionSchema = z.object({
  waferId: z.string().max(80), alertIndex: z.number().int().nonnegative(),
  filter: z.enum(['all', 'alert', 'quiet']), tab: z.enum(['analysis', 'validation', 'limitations']), detailOpen: z.boolean(),
});
const sessionSchema = z.object({
  version: z.literal(1), mode: z.enum(['summary', 'backend']),
  replayView: z.enum(['bundled', 'imported', 'backend']).optional(),
  replay: z.object({ data: replaySchema, filename: z.string().min(1).max(1000), selection: selectionSchema }).optional(),
}).refine(value => value.mode !== 'summary' || Boolean(value.replay));

export function readSourceSession(): SourceSession | null {
  try {
    const raw = sessionStorage.getItem(sourceSessionKey);
    if (!raw) return null;
    return sessionSchema.parse(JSON.parse(raw));
  } catch { return null; }
}

// Persist before replacing the visible source. A quota failure must not silently
// accept a file that will disappear on the next native page navigation.
export function writeSourceSession(value: SourceSession): void {
  // Workspace replacements retain Replay's independently selected view.
  const checked = sessionSchema.parse({ replayView: readSourceSession()?.replayView, ...value });
  sessionStorage.setItem(sourceSessionKey, JSON.stringify(checked));
}

export function readReplayView(): ReplayView {
  const saved = readSourceSession();
  if (saved?.replayView === 'imported' && !saved.replay) return 'bundled';
  return saved?.replayView ?? 'bundled';
}

export function selectReplayView(replayView: ReplayView): void {
  // Changing the Analysis view never discards an import or changes Workspace mode.
  writeSourceSession({ version: 1, mode: 'backend', ...readSourceSession(), replayView });
}

export function selectBackendSource(): void {
  writeSourceSession({ ...readSourceSession(), version: 1, mode: 'backend' });
}

export function updateReplaySelection(selection: ReplaySelection): void {
  const saved = readSourceSession();
  if (saved?.replay) writeSourceSession({ ...saved, replay: { ...saved.replay, selection } });
}
