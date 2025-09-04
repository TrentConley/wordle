import test from 'node:test';
import assert from 'node:assert/strict';
import { makeReq, makeRes } from './_utils.js';

process.env.NODE_ENV = 'test';

const { handleApiLeaderboard } = await import('../server.js');

test('GET /api/leaderboard returns JSON (or error object)', async () => {
  const req = makeReq();
  const res = makeRes();
  await handleApiLeaderboard(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.body, 'object');
  assert.ok('leaderboard' in res.body || 'error' in res.body);
});
