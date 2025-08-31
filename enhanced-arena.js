import { OpenRouterClient } from './openrouter.js';
import { WordleGame } from './wordle.js';
import { writeFileSync, mkdirSync } from 'fs';
import { PREMIUM_MODELS, MODEL_CONFIGS } from './config.js';
import axios from 'axios';
import path from 'path';

export class EnhancedWordleArena {
  constructor() {
    this.client = new EnhancedOpenRouterClient();
    this.models = PREMIUM_MODELS;
    
    // Create directories for detailed logs
    this.ensureDirectories();
  }

  ensureDirectories() {
    try {
      mkdirSync('results', { recursive: true });
      mkdirSync('results/detailed', { recursive: true });
      mkdirSync('results/responses', { recursive: true });
    } catch (error) {
      // Directories might already exist
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

  async playGame(model, targetWord, gameNumber = 1) {
    const game = new WordleGame(targetWord);
    const gameLog = {
      model,
      targetWord,
      gameNumber,
      guesses: [],
      won: false,
      guessCount: 0,
      error: null,
      responses: [],
      prompts: []
    };

    try {
      while (!game.gameOver) {
        const gameState = game.getGameState();
        const prompt = this.createPrompt(gameState);
        gameLog.prompts.push(prompt);
        
        const messages = [
          { role: 'user', content: prompt }
        ];

        let guess;
        let rawResponse = '';
        try {
          const modelConfig = MODEL_CONFIGS[model] || {};
          const maxTokens = modelConfig.maxTokens || 50;
          
          // Store raw API response before processing
          const response = await this.client.chatRaw(model, messages, maxTokens);
          rawResponse = response.trim();
          guess = await this.client.chat(model, messages, maxTokens);
          
          gameLog.responses.push({
            prompt: prompt,
            rawResponse: rawResponse,
            processedGuess: guess,
            guessNumber: gameLog.guesses.length + 1
          });
          
        } catch (error) {
          gameLog.error = `API Error: ${error.message}`;
          gameLog.responses.push({
            prompt: prompt,
            error: error.message,
            guessNumber: gameLog.guesses.length + 1
          });
          break;
        }

        const result = game.makeGuess(guess);
        gameLog.guesses.push({
          word: guess,
          result: result.result,
          feedback: result
        });

        if (result.error) {
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
      gameLog.error = `Game Error: ${error.message}`;
    }

    return gameLog;
  }

  async runArena(rounds = 20) {
    console.log(`Starting Enhanced Wordle Arena with ${rounds} rounds per model...`);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
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

      const modelResponses = [];

      for (let i = 0; i < rounds; i++) {
        if ((i + 1) % 5 === 0) {
          console.log(`  Round ${i + 1}/${rounds}`);
        }

        const game = new WordleGame();
        const targetWord = game.targetWord;
        const gameResult = await this.playGame(model, targetWord, i + 1);
        
        results[model].games.push(gameResult);
        modelResponses.push(gameResult);
        
        if (gameResult.error) {
          results[model].stats.errors++;
        } else if (gameResult.won) {
          results[model].stats.wins++;
          results[model].stats.guessDistribution[gameResult.guessCount]++;
        } else {
          results[model].stats.losses++;
        }
      }

      // Save detailed responses for this model
      const modelName = model.replace(/[\/\\:*?"<>|]/g, '_');
      const responseFile = `results/responses/${modelName}_${timestamp}.json`;
      writeFileSync(responseFile, JSON.stringify(modelResponses, null, 2));
      console.log(`  📝 Detailed responses saved: ${responseFile}`);

      this.calculateStats(results[model].stats, results[model].games);
      this.printModelStats(model, results[model].stats);
    }

    // Save main results
    const resultsFile = `results/wordle-arena-results-${timestamp}.json`;
    writeFileSync(resultsFile, JSON.stringify(results, null, 2));
    
    // Save detailed summary
    const summaryFile = `results/detailed/arena-summary-${timestamp}.json`;
    const summary = {
      timestamp: new Date().toISOString(),
      rounds,
      models: this.models.length,
      results,
      leaderboard: this.createLeaderboard(results)
    };
    writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
    
    this.printFinalRankings(results);
    
    console.log(`\n📊 Results saved to: ${resultsFile}`);
    console.log(`📋 Summary saved to: ${summaryFile}`);
    console.log(`🔍 Individual responses in: results/responses/`);
    
    return results;
  }

  createLeaderboard(results) {
    return Object.entries(results)
      .map(([model, data]) => ({
        model,
        winRate: data.stats.winRate,
        averageGuesses: data.stats.averageGuesses,
        wins: data.stats.wins,
        losses: data.stats.losses,
        errors: data.stats.errors,
        guessDistribution: data.stats.guessDistribution
      }))
      .sort((a, b) => {
        if (Math.abs(a.winRate - b.winRate) > 1) {
          return b.winRate - a.winRate;
        }
        return a.averageGuesses - b.averageGuesses;
      });
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
    const rankings = this.createLeaderboard(results);

    rankings.forEach((entry, index) => {
      console.log(`${index + 1}. ${entry.model}`);
      console.log(`   Win Rate: ${entry.winRate.toFixed(1)}%`);
      console.log(`   Avg Guesses: ${entry.averageGuesses.toFixed(2)}`);
      console.log(`   Errors: ${entry.errors}`);
      console.log('');
    });
  }
}

// Enhanced client with raw response capability
class EnhancedOpenRouterClient extends OpenRouterClient {
  async chatRaw(model, messages, maxTokens = 50) {
    try {
      const modelConfig = MODEL_CONFIGS[model] || {};
      const requestBody = {
        model: model,
        messages: messages,
        max_tokens: maxTokens,
        temperature: modelConfig.temperature || 0.1
      };

      if (modelConfig.reasoning) {
        if (typeof modelConfig.reasoning === 'object') {
          requestBody.reasoning = modelConfig.reasoning;
        } else if (modelConfig.reasoning === true) {
          requestBody.reasoning = true;
        }
      }

      const response = await axios.post(
        `${this.baseURL}/chat/completions`,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:8080',
            'X-Title': 'LLM Wordle Arena'
          }
        }
      );

      return response.data.choices[0].message.content.trim();
    } catch (error) {
      console.error(`Raw error calling ${model}:`, error.response?.data || error.message);
      throw error;
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arena = new EnhancedWordleArena();
  const rounds = parseInt(process.argv[2]) || 20;
  
  arena.runArena(rounds).catch(console.error);
}