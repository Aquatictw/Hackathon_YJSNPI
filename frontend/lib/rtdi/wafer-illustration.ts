/** Fixed illustrative positions, never spatial bin/measurement coordinates. */
export const WAFER_TILE_COUNT = 400;
export const waferTiles = Array.from({ length: 24 * 24 }, (_, index) => {
  const column = index % 24, row = Math.floor(index / 24);
  return { x: 200 + (column - 11.5) * 14.9, y: 200 + (row - 11.5) * 14.9, index };
}).sort((a, b) => ((a.x - 200) ** 2 + (a.y - 200) ** 2) - ((b.x - 200) ** 2 + (b.y - 200) ** 2) || a.index - b.index)
  .slice(0, WAFER_TILE_COUNT)
  // 137 is coprime to 400: each tile has a unique, deterministic scatter rank.
  .map((tile, index) => ({ ...tile, rank: (index * 137 + 53) % WAFER_TILE_COUNT }));

export function waferFailureTiles(yieldRatio: number | undefined): number | null {
  if (yieldRatio === undefined || !Number.isFinite(yieldRatio) || yieldRatio < 0 || yieldRatio > 1) return null;
  return Math.round((1 - yieldRatio) * WAFER_TILE_COUNT);
}
