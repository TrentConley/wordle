import { OpenRouterClient } from './openrouter.js';
import { WordleGame } from './wordle.js';
import { writeFileSync, appendFileSync } from 'fs';
import { PREMIUM_MODELS, CUTTING_EDGE_MODELS, GROK_GPT5_TEST, MODEL_CONFIGS } from './config.js';

export class WordleArena {
  constructor(modelSet = 'premium') {
    this.client = new OpenRouterClient();
    this.setModelSet(modelSet);
  }
  
  setModelSet(modelSet) {
    switch(modelSet) {
      case 'cutting-edge':
        this.models = CUTTING_EDGE_MODELS;
        break;
      case 'grok-gpt5':
        this.models = GROK_GPT5_TEST;
        break;
      default:
        this.models = PREMIUM_MODELS;
    }
  }

  createPrompt(gameState) {
    let prompt = `You are playing Wordle. The goal is to guess a 5-letter word in 6 tries or fewer.

Rules:
- Each guess must be exactly 5 letters
- After each guess, you'll get feedback with three categories:
  * 'correct' = letters in the right position
  * 'wrong_position' = letters in the word but wrong position  
  * 'not_in_word' = letters not in the target word
- Use this feedback to make better guesses

`;

    if (gameState.guesses.length > 0) {
      prompt += "Previous guesses and feedback:\n";
      gameState.guesses.forEach((guess, index) => {
        const result = guess.result;
        const correct = result.correct.map(c => `${c.letter}@${c.position}`).join(' ');
        const wrongPos = result.wrong_position.map(w => `${w.letter}@${w.position}`).join(' ');
        const notInWord = result.not_in_word.map(n => `${n.letter}@${n.position}`).join(' ');
        
        prompt += `${index + 1}. ${guess.word}\n`;
        if (correct) prompt += `   Correct: ${correct}\n`;
        if (wrongPos) prompt += `   Wrong position: ${wrongPos}\n`;
        if (notInWord) prompt += `   Not in word: ${notInWord}\n`;
      });
      prompt += "\n";
    }

    prompt += `You have ${gameState.guessesRemaining} guesses remaining.
    
CRITICAL: Respond with ONLY a single 5-letter word in uppercase. No explanations, no punctuation, no extra text. Just the word.`;

    return prompt;
  }

  async playGame(model, targetWord) {
    const game = new WordleGame(targetWord);
    const gameLog = {
      model,
      targetWord,
      guesses: [],
      won: false,
      guessCount: 0,
      error: null
    };

    try {
      while (!game.gameOver) {
        const gameState = game.getGameState();
        const prompt = this.createPrompt(gameState);
        
        const messages = [
          { role: 'user', content: prompt }
        ];

        let guess, rawResponse;
        try {
          const modelConfig = MODEL_CONFIGS[model] || {};
          const maxTokens = modelConfig.maxTokens || 50;
          const response = await this.client.chat(model, messages, maxTokens);
          rawResponse = response;
          guess = response;
        } catch (error) {
          const errorInfo = {
            type: 'API_ERROR',
            message: error.message,
            model: model,
            targetWord: targetWord,
            attempt: gameState.guesses.length + 1,
            timestamp: new Date().toISOString()
          };
          console.error(`🚨 Game ${gameState.guesses.length + 1} API Error for ${model}:`, errorInfo);
          appendFileSync('arena-errors.log', `${new Date().toISOString()} - GAME_API_ERROR: ${JSON.stringify(errorInfo)}\n`);
          gameLog.error = `API Error: ${error.message}`;
          break;
        }

        const result = game.makeGuess(guess);
        gameLog.guesses.push({
          word: guess,
          result: result.result,
          feedback: result,
          rawResponse: rawResponse,
          timestamp: new Date().toISOString()
        });

        if (result.error) {
          const gameError = {
            type: 'GAME_ERROR',
            message: result.error,
            model: model,
            targetWord: targetWord,
            guess: guess,
            attempt: gameState.guesses.length + 1,
            timestamp: new Date().toISOString()
          };
          console.error(`🎯 Game Error for ${model}:`, gameError);
          appendFileSync('arena-errors.log', `${new Date().toISOString()} - GAME_ERROR: ${JSON.stringify(gameError)}\n`);
          gameLog.error = result.error;
          break;
        }

        if (result.gameOver) {
          gameLog.won = result.won;
          gameLog.guessCount = result.guessNumber;
          break;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      const unexpectedError = {
        type: 'UNEXPECTED_ERROR',
        message: error.message,
        stack: error.stack,
        model: model,
        targetWord: targetWord,
        timestamp: new Date().toISOString()
      };
      console.error(`💥 Unexpected Error for ${model}:`, unexpectedError);
      appendFileSync('arena-errors.log', `${new Date().toISOString()} - UNEXPECTED_ERROR: ${JSON.stringify(unexpectedError)}\n`);
      gameLog.error = `Game Error: ${error.message}`;
    }

    return gameLog;
  }

  async runArena(rounds = 100) {
    console.log(`Starting Wordle Arena with ${rounds} rounds per model...`);
    const results = {};
    
    for (const model of this.models) {
      console.log(`\nTesting ${model}...`);
      results[model] = {
        games: [],
        stats: {
          wins: 0,
          losses: 0,
          averageGuesses: 0,
          errors: 0,
          winRate: 0,
          guessDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
        }
      };

      for (let i = 0; i < rounds; i++) {
        if ((i + 1) % 10 === 0) {
          console.log(`  Round ${i + 1}/${rounds}`);
        }

        const game = new WordleGame();
        const targetWord = game.targetWord;
        const gameResult = await this.playGame(model, targetWord);
        
        results[model].games.push(gameResult);
        
        if (gameResult.error) {
          results[model].stats.errors++;
        } else if (gameResult.won) {
          results[model].stats.wins++;
          results[model].stats.guessDistribution[gameResult.guessCount]++;
        } else {
          results[model].stats.losses++;
        }
      }

      this.calculateStats(results[model].stats, results[model].games);
      this.printModelStats(model, results[model].stats);
    }

    this.saveResults(results);
    this.printFinalRankings(results);
    
    return results;
  }

  calculateStats(stats, games) {
    const validGames = games.filter(g => !g.error);
    const wins = validGames.filter(g => g.won);
    
    stats.winRate = validGames.length > 0 ? (wins.length / validGames.length * 100) : 0;
    stats.averageGuesses = wins.length > 0 ? 
      (wins.reduce((sum, g) => sum + g.guessCount, 0) / wins.length) : 0;
  }

  printModelStats(model, stats) {
    console.log(`\n${model} Results:`);
    console.log(`  Win Rate: ${stats.winRate.toFixed(1)}% (${stats.wins}/${stats.wins + stats.losses})`);
    console.log(`  Average Guesses (wins): ${stats.averageGuesses.toFixed(2)}`);
    console.log(`  Errors: ${stats.errors}`);
    console.log(`  Guess Distribution: ${JSON.stringify(stats.guessDistribution)}`);
  }

  printFinalRankings(results) {
    console.log('\n=== FINAL RANKINGS ===');
    const rankings = Object.entries(results)
      .map(([model, data]) => ({
        model,
        winRate: data.stats.winRate,
        averageGuesses: data.stats.averageGuesses,
        errors: data.stats.errors
      }))
      .sort((a, b) => {
        if (Math.abs(a.winRate - b.winRate) > 1) {
          return b.winRate - a.winRate;
        }
        return a.averageGuesses - b.averageGuesses;
      });

    rankings.forEach((entry, index) => {
      console.log(`${index + 1}. ${entry.model}`);
      console.log(`   Win Rate: ${entry.winRate.toFixed(1)}%`);
      console.log(`   Avg Guesses: ${entry.averageGuesses.toFixed(2)}`);
      console.log(`   Errors: ${entry.errors}`);
      console.log('');
    });
  }

  saveResults(results) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `wordle-arena-results-${timestamp}.json`;
    
    const enhancedResults = {
      metadata: {
        timestamp: new Date().toISOString(),
        totalModels: this.models.length,
        models: this.models,
        version: "2.0"
      },
      results: results
    };
    
    writeFileSync(filename, JSON.stringify(enhancedResults, null, 2));
    console.log(`\nResults saved to: ${filename}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arena = new WordleArena();
  const rounds = parseInt(process.argv[2]) || 100;
  
  arena.runArena(rounds).catch(console.error);
}