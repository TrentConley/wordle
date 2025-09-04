import test from 'node:test';
import assert from 'node:assert/strict';
import { makeReq, makeRes } from './_utils.js';

process.env.NODE_ENV = 'test';

const { handleH2HJoin, handleH2HMatchFor, handleH2HState, handleH2HGuess } = await import('../server.js');

test('H2H queue and matching', async () => {
  const p1 = 'player-A';
  const p2 = 'player-B';

  const r1 = makeRes();
  await handleH2HJoin(makeReq({ method: 'POST', body: { playerId: p1, playerName: 'Alice' } }), r1);
  assert.equal(r1.statusCode, 200);
  assert.equal(r1.body.status, 'waiting');

  const r2 = makeRes();
  await handleH2HJoin(makeReq({ method: 'POST', body: { playerId: p2, playerName: 'Bob' } }), r2);
  assert.equal(r2.statusCode, 200);
  assert.equal(r2.body.status, 'matched');
  const matchId = r2.body.matchId;
  assert.ok(matchId);

  const mres = makeRes();
  await handleH2HMatchFor(makeReq({ params: { playerId: p1 } }), mres);
  assert.equal(mres.statusCode, 200);
  assert.equal(mres.body.status, 'matched');
  assert.equal(mres.body.matchId, matchId);

  const sres = makeRes();
  await handleH2HState(makeReq({ params: { id: matchId } }), sres);
  assert.equal(sres.statusCode, 200);
  assert.equal(sres.body.over, false);
  assert.ok(sres.body.players.a && sres.body.players.b);

  // invalid guess (length)
  const badRes = makeRes();
  await handleH2HGuess(makeReq({ method: 'POST', params: { id: matchId }, body: { playerId: p1, word: 'DOG' } }), badRes);
  assert.equal(badRes.statusCode, 400);

  // valid-form guess (dict may accept/reject, we expect 200 with OK or 400)
  const gRes = makeRes();
  await handleH2HGuess(makeReq({ method: 'POST', params: { id: matchId }, body: { playerId: p1, word: 'SLATE' } }), gRes);
  assert.ok([200, 400].includes(gRes.statusCode));
});
