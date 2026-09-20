import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeletedTrainingScope } from '../scripts/local-backend.mjs';

test('training seed skips only the exact intentional deletion conflict', () => {
  const scope = ['grp6-replay-demo', 'grp6-replay'];
  const batch = { events: [{ run_id: scope[0], tester_id: scope[1] }] };
  const body = { error: 'run_scope_deleted', conflicting_ids: [JSON.stringify(scope)] };
  assert.equal(isDeletedTrainingScope({ status: 409 }, body, batch), true);
  for (const status of [200, 404, 500]) assert.equal(isDeletedTrainingScope({ status }, body, batch), false);
  for (const changed of [null, {}, { ...body, error: 'identity_conflict' },
    { ...body, conflicting_ids: [] }, { ...body, conflicting_ids: ['other'] },
    { ...body, conflicting_ids: [...body.conflicting_ids, 'other'] }]) {
    assert.equal(isDeletedTrainingScope({ status: 409 }, changed, batch), false);
  }
  for (const events of [[], [{ run_id: scope[0], tester_id: 'other' }],
    [{ run_id: 'other', tester_id: scope[1] }], [...batch.events, { run_id: 'other', tester_id: 'other' }]]) {
    assert.equal(isDeletedTrainingScope({ status: 409 }, body, { events }), false);
  }
});
