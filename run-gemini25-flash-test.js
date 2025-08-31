import { WordleArena } from './arena.js';

class Gemini25FlashArena extends WordleArena {
  constructor() {
    super();
    this.models = ['google/gemini-2.5-flash'];
  }
}

const arena = new Gemini25FlashArena();
console.log('Starting 100-round test for Gemini 2.5 Flash...');
arena.runArena(100).catch(console.error);