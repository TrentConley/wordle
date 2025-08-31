import { WordleArena } from './arena.js';

class Gemini25Arena extends WordleArena {
  constructor() {
    super();
    this.models = ['google/gemini-2.5-pro'];
  }
}

const arena = new Gemini25Arena();
console.log('Starting 100-round test for Gemini 2.5 Pro...');
arena.runArena(100).catch(console.error);