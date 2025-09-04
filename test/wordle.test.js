import test from 'node:test';
import assert from 'node:assert/strict';
import { WordleGame } from '../wordle.js';

test('WordleGame basic flow', () => {
  const game = new WordleGame('CRANE');
  // invalid length
  assert.equal(game.makeGuess('CAT').error, 'Word must be 5 letters long');
  // valid wrong guess
  const r1 = game.makeGuess('SLATE');
  assert.equal(r1.word, 'SLATE');
  assert.equal(r1.gameOver, false);
  // Contains present/correct classifications
  assert.ok(Array.isArray(r1.result.correct));
  assert.ok(Array.isArray(r1.result.wrong_position));
  assert.ok(Array.isArray(r1.result.not_in_word));

  // win
  const r2 = game.makeGuess('CRANE');
  assert.equal(r2.won, true);
  assert.equal(r2.gameOver, true);
  assert.equal(r2.targetWord, 'CRANE');
});

