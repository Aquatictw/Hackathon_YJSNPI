import { json } from '@/lib/rtdi/http';
import { listRuns } from '@/lib/rtdi/repository';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const limitText = params.get('limit') ?? '100';
  const offsetText = params.get('offset') ?? '0';
  const limit = Number(limitText), offset = Number(offsetText);
  if (!/^\d+$/.test(limitText) || !/^\d+$/.test(offsetText) || !Number.isSafeInteger(offset)
      || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return json({ error: 'Invalid run list pagination.' }, 422);
  }
  try {
    return json(await listRuns({ limit, offset }));
  } catch {
    return json({ error: 'Stored runs are temporarily unavailable.' }, 503);
  }
}
