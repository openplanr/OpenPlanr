import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDueDate } from '../../src/dates.js';
import { withServer } from '../helpers.js';

function inZone(zone, run) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    process.env.TZ = previous;
  }
}

for (const zone of ['America/Los_Angeles', 'Pacific/Auckland', 'UTC']) {
  test(`a due date formats as saved in ${zone}`, () => {
    inZone(zone, () => {
      assert.equal(formatDueDate('2026-03-10'), '2026-03-10');
      assert.equal(formatDueDate('2026-11-01'), '2026-11-01');
      assert.equal(formatDueDate('2026-01-01'), '2026-01-01');
    });
  });
}

test('the API returns the saved due date west of UTC', async () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    await withServer(async (call) => {
      const created = await call('POST', '/notes', { body: { title: 'Taxes', due: '2026-03-10' } });
      const read = await call('GET', `/notes/${created.body.id}`);
      assert.equal(read.body.due, '2026-03-10');
    });
  } finally {
    process.env.TZ = previous;
  }
});
