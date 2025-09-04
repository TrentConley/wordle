import test from 'node:test';
import assert from 'node:assert/strict';
import { makeReq, makeRes } from './_utils.js';

process.env.NODE_ENV = 'test';

const { handlePvpStart, handlePvpState, handlePvpGuess } = await import('../server.js');

test('PvAI lifecycle: start -> state -> guess', async () => {
  // start game
  const startReq = makeReq({ method: 'POST', body: { model: 'openai/gpt-4o', playerId: 'test-user', playerName: 'Tester' } });
  const startRes = makeRes();
  await handlePvpStart(startReq, startRes);
  assert.equal(startRes.statusCode, 200);
  assert.ok(startRes.body.id);
  const id = startRes.body.id;

  // state
  const stateReq = makeReq({ params: { id } });
  const stateRes = makeRes();
  await handlePvpState(stateReq, stateRes);
  assert.equal(stateRes.statusCode, 200);
  assert.equal(stateRes.body.over, false);
  assert.equal(Array.isArray(stateRes.body.humanGuesses), true);

  // submit invalid guess (length)
  const badReq = makeReq({ method: 'POST', params: { id }, body: { word: 'CAT' } });
  const badRes = makeRes();
  await handlePvpGuess(badReq, badRes);
  assert.equal(badRes.statusCode, 400);

  // submit 5-letter placeholder (dict may accept/reject)
  const goodReq = makeReq({ method: 'POST', params: { id }, body: { word: 'SLATE' } });
  const goodRes = makeRes();
  await handlePvpGuess(goodReq, goodRes);
  assert.ok([200, 400].includes(goodRes.statusCode));
});
