import express from 'express';
import cors from 'cors';
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WordleArena } from './arena.js';
import { WordleGame } from './wordle.js';
import { OpenRouterClient } from './openrouter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 8080;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let currentArena = null;
let isRunning = false;
let currentProgress = { total: 0, completed: 0, currentModel: '' };

// --- Simple in-memory PvP store ---
const pvpGames = new Map(); // gameId -> { game: WordleGame, id, createdAt, model, humanGuesses: [], llmGuesses: [], over, wonBy, targetWord }
let nextGameId = 1;

// Ensure results/pvp directory exists for logs
try {
  mkdirSync('results', { recursive: true });
  mkdirSync('results/pvp', { recursive: true });
} catch {}

const getLatestResults = () => {
  try {
    const files = readdirSync('.')
      .filter(f => (f.startsWith('wordle-arena-results-') || f.startsWith('combined-best-results-') || f.startsWith('temp-')) && f.endsWith('.json'))
      .sort()
      .reverse();
    
    if (files.length === 0) return null;
    
    // Prioritize combined results over individual runs
    const combinedFile = files.find(f => f.startsWith('combined-best-results-'));
    const latestFile = combinedFile || files[0];
    
    const rawData = JSON.parse(readFileSync(latestFile, 'utf8'));
    
    // Handle both old and new result formats
    const data = rawData.results ? rawData.results : rawData;
    const metadata = rawData.metadata || { version: "1.0" };
    
    return { filename: latestFile, data, metadata };
  } catch (error) {
    console.error('Error reading results:', error);
    return null;
  }
};

app.get('/api/leaderboard', (req, res) => {
  const results = getLatestResults();
  if (!results) {
    return res.json({ error: 'No results available' });
  }

  const leaderboard = Object.entries(results.data)
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

  res.json({
    leaderboard,
    lastUpdated: results.filename,
    isRunning,
    progress: currentProgress
  });
});

// --- PvP (Human vs LLM) endpoints ---
app.post('/api/pvp/start', (req, res) => {
  try {
    const model = (req.body && req.body.model) || 'openai/gpt-5-chat';
    const target = (req.body && req.body.targetWord) || null;
    const game = new WordleGame(target);
    const id = String(nextGameId++);
    const record = {
      id,
      game,
      model,
      createdAt: new Date().toISOString(),
      humanGuesses: [],
      llmGuesses: [],
      over: false,
      wonBy: null,
      targetWord: game.targetWord
    };
    pvpGames.set(id, record);
    res.json({ id, model, guessesRemaining: game.maxGuesses, createdAt: record.createdAt });
  } catch (e) {
    res.status(500).json({ error: 'Failed to start game' });
  }
});

app.get('/api/pvp/state/:id', (req, res) => {
  const rec = pvpGames.get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Game not found' });
  const state = rec.game.getGameState();
  const isOver = rec.over || state.gameOver;
  res.json({
    id: rec.id,
    model: rec.model,
    createdAt: rec.createdAt,
    humanGuesses: rec.humanGuesses,
    llmGuesses: rec.llmGuesses,
    over: isOver,
    wonBy: rec.wonBy,
    guessesRemaining: state.guessesRemaining,
    targetWord: isOver ? state.targetWord : null
  });
});

// Human submits a guess; immediately schedule LLM guess using latest context
app.post('/api/pvp/guess/:id', async (req, res) => {
  const rec = pvpGames.get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Game not found' });
  if (!req.body || !req.body.word) return res.status(400).json({ error: 'Missing word' });

  const humanWord = String(req.body.word).toUpperCase();
  const humanResult = rec.game.makeGuess(humanWord);
  if (humanResult.error) return res.status(400).json({ error: humanResult.error });
  rec.humanGuesses.push({ word: humanWord, result: humanResult.result, timestamp: new Date().toISOString() });

  if (humanResult.gameOver) {
    rec.over = true;
    rec.wonBy = humanResult.won ? 'human' : 'none';
    persistPvp(rec);
    return res.json({ human: humanResult, llm: null, over: rec.over, wonBy: rec.wonBy });
  }

  // Fire LLM guess without blocking user response
  triggerLlmGuess(rec).catch(err => {
    appendFileSync('arena-errors.log', `${new Date().toISOString()} - PVP_LLM_GUESS_ERROR: ${err.message}\n`);
  });

  res.json({ human: humanResult, llm: null, over: rec.over, wonBy: rec.wonBy });
});

async function triggerLlmGuess(rec) {
  if (rec.over) return;
  const arena = new WordleArena();
  // Build game state from the authoritative game in rec, but exclude human guesses
  const gameState = rec.game.getGameState();
  
  // Create a modified game state that only includes LLM's own guesses
  const llmOnlyGuesses = rec.llmGuesses.filter(g => g.word && g.result).map(g => ({
    word: g.word,
    result: g.result
  }));
  
  const llmGameState = {
    ...gameState,
    guesses: llmOnlyGuesses,
    guessesRemaining: Math.max(0, 6 - llmOnlyGuesses.length)
  };
  
  const prompt = arena.createPrompt(llmGameState);
  const client = new OpenRouterClient();

  try {
    const guess = await client.chat(rec.model, [{ role: 'user', content: prompt }], 50);
    const llmResult = rec.game.makeGuess(guess);
    rec.llmGuesses.push({ word: guess, result: llmResult.result, timestamp: new Date().toISOString() });
    if (llmResult.gameOver) {
      rec.over = true;
      rec.wonBy = llmResult.won ? 'llm' : 'none';
      persistPvp(rec);
    }
  } catch (e) {
    rec.llmGuesses.push({ word: null, error: e.message, timestamp: new Date().toISOString() });
  }
}

function persistPvp(rec) {
  try {
    const data = {
      id: rec.id,
      model: rec.model,
      createdAt: rec.createdAt,
      targetWord: rec.targetWord,
      humanGuesses: rec.humanGuesses,
      llmGuesses: rec.llmGuesses,
      over: rec.over,
      wonBy: rec.wonBy
    };
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(`results/pvp/game-${rec.id}-${ts}.json`, JSON.stringify(data, null, 2));
  } catch {}
}

// List PvP games (from disk, newest first)
app.get('/api/pvp/games', (req, res) => {
  try {
    const files = readdirSync('results/pvp')
      .filter(f => f.startsWith('game-') && f.endsWith('.json'))
      .sort()
      .reverse();
    res.json({ files });
  } catch (e) {
    res.json({ files: [] });
  }
});

app.get('/api/results/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    if (!existsSync(filename)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const data = JSON.parse(readFileSync(filename, 'utf8'));
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Error reading file' });
  }
});

app.post('/api/start-arena', async (req, res) => {
  if (isRunning) {
    return res.json({ error: 'Arena is already running' });
  }

  const rounds = req.body.rounds || 10;
  const modelSet = req.body.modelSet || 'premium';
  
  isRunning = true;
  currentProgress = { total: 0, completed: 0, currentModel: '' };
  
  try {
    currentArena = new WordleArena(modelSet);
    const models = currentArena.models;
    currentProgress.total = models.length * rounds;
    
    res.json({ message: 'Arena started', rounds, models: models.length });
    
    // Run arena in background
    const results = await currentArena.runArena(rounds);
    isRunning = false;
    currentProgress.completed = currentProgress.total;
    
  } catch (error) {
    console.error('Arena error:', error);
    isRunning = false;
    currentProgress = { total: 0, completed: 0, currentModel: 'Error occurred', error: error.message };
  }
});

app.get('/api/progress', (req, res) => {
  res.json({
    isRunning,
    progress: currentProgress
  });
});

app.get('/api/games/:model', (req, res) => {
  const results = getLatestResults();
  if (!results) {
    return res.json({ error: 'No results available' });
  }

  const modelName = decodeURIComponent(req.params.model);
  const modelData = results.data[modelName];
  
  if (!modelData) {
    return res.status(404).json({ error: 'Model not found' });
  }

  const games = modelData.games.map((game, index) => ({
    gameNumber: index + 1,
    targetWord: game.targetWord,
    won: game.won,
    guessCount: game.guessCount,
    error: game.error,
    guesses: game.guesses.map(guess => ({
      word: guess.word,
      result: guess.result,
      rawResponse: guess.rawResponse
    }))
  }));

  res.json({
    model: modelName,
    totalGames: games.length,
    games: games
  });
});

app.get('/api/game/:model/:gameNumber', (req, res) => {
  const results = getLatestResults();
  if (!results) {
    return res.json({ error: 'No results available' });
  }

  const modelName = decodeURIComponent(req.params.model);
  const gameNumber = parseInt(req.params.gameNumber) - 1;
  const modelData = results.data[modelName];
  
  if (!modelData || !modelData.games[gameNumber]) {
    return res.status(404).json({ error: 'Game not found' });
  }

  const game = modelData.games[gameNumber];
  
  res.json({
    model: modelName,
    gameNumber: gameNumber + 1,
    targetWord: game.targetWord,
    won: game.won,
    guessCount: game.guessCount,
    error: game.error,
    guesses: game.guesses.map(guess => ({
      word: guess.word,
      result: guess.result,
      rawResponse: guess.rawResponse,
      timestamp: guess.timestamp
    }))
  });
});

app.get('/', (req, res) => {
  res.send(generateHTML());
});

// Split-screen PvP UI (static asset)
app.get('/pvp', (req, res) => {
  res.sendFile(join(__dirname, 'public/pvp/index.html'));
});

function generateHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>LLM Wordle Arena Leaderboard</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        html {
            scroll-behavior: smooth;
        }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%);
            min-height: 100vh;
            padding: 20px;
            color: #f1f5f9;
            overflow-x: hidden;
        }
        
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: 
                radial-gradient(circle at 20% 80%, rgba(71, 85, 105, 0.1) 0%, transparent 50%),
                radial-gradient(circle at 80% 20%, rgba(100, 116, 139, 0.08) 0%, transparent 50%);
            pointer-events: none;
            z-index: -1;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: rgba(15, 23, 42, 0.95);
            border: 1px solid rgba(71, 85, 105, 0.2);
            border-radius: 20px;
            box-shadow: 
                0 25px 50px rgba(0,0,0,0.6),
                0 0 0 1px rgba(241, 245, 249, 0.03) inset;
            backdrop-filter: blur(20px);
            overflow: hidden;
            position: relative;
        }
        
        .container::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 1px;
            background: linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.3), transparent);
        }
        
        .header {
            background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.9) 50%, rgba(51, 65, 85, 0.8) 100%);
            border-bottom: 1px solid rgba(71, 85, 105, 0.3);
            color: #f8fafc;
            padding: 40px 30px;
            text-align: center;
            position: relative;
            overflow: hidden;
        }

        .header::before {
            content: '';
            position: absolute;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: radial-gradient(circle at 30% 40%, rgba(148, 163, 184, 0.1) 0%, transparent 50%),
                        radial-gradient(circle at 70% 60%, rgba(100, 116, 139, 0.08) 0%, transparent 50%);
            animation: subtle-float 20s ease-in-out infinite;
        }

        @keyframes subtle-float {
            0%, 100% { transform: translateY(0px) rotate(0deg); }
            50% { transform: translateY(-10px) rotate(1deg); }
        }

        .header h1 {
            font-size: 2.8em;
            font-weight: 300;
            margin: 0;
            letter-spacing: -0.02em;
            background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            position: relative;
            z-index: 2;
            text-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .header .subtitle {
            font-size: 1.1em;
            opacity: 0.7;
            font-weight: 400;
            margin-top: 8px;
            position: relative;
            z-index: 2;
            color: #cbd5e1;
        }

        .header .stats {
            font-size: 0.85em;
            opacity: 0.6;
            margin-top: 20px;
            position: relative;
            z-index: 2;
            color: #94a3b8;
            font-weight: 500;
        }
        

        
        .btn {
            background: linear-gradient(135deg, #475569 0%, #64748b 100%);
            color: #f8fafc;
            border: 1px solid rgba(100, 116, 139, 0.4);
            padding: 12px 24px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .btn::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
            transition: left 0.5s;
        }
        
        .btn:hover::before {
            left: 100%;
        }
        
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(71, 85, 105, 0.4);
            background: linear-gradient(135deg, #334155 0%, #475569 100%);
        }
        
        .btn:disabled {
            background: rgba(71, 85, 105, 0.3);
            border-color: rgba(100, 116, 139, 0.2);
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
            color: #94a3b8;
        }
        
        .input {
            padding: 12px 16px;
            border: 1px solid rgba(100, 116, 139, 0.3);
            border-radius: 8px;
            font-size: 14px;
            background: rgba(30, 41, 59, 0.8);
            color: #f1f5f9;
            transition: all 0.3s ease;
            backdrop-filter: blur(10px);
        }
        
        .input:focus {
            outline: none;
            border-color: rgba(148, 163, 184, 0.6);
            box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.1);
        }
        
        .status {
            padding: 20px 25px;
            background: rgba(20, 184, 166, 0.1);
            border: 1px solid rgba(20, 184, 166, 0.3);
            border-left: 4px solid #14b8a6;
            margin: 20px;
            border-radius: 16px;
            backdrop-filter: blur(10px);
            box-shadow: 0 4px 12px rgba(20, 184, 166, 0.15);
        }
        
        .progress {
            background: rgba(31, 41, 55, 0.6);
            border: 1px solid rgba(75, 85, 99, 0.3);
            border-radius: 12px;
            overflow: hidden;
            margin: 15px 0;
            backdrop-filter: blur(5px);
        }
        
        .progress-bar {
            background: linear-gradient(90deg, #14b8a6, #06d6a0);
            height: 24px;
            transition: width 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 13px;
            font-weight: 600;
            position: relative;
            overflow: hidden;
        }
        
        .progress-bar::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
            animation: shimmer 2s infinite;
        }
        
        @keyframes shimmer {
            0% { left: -100%; }
            100% { left: 100%; }
        }
        
        .leaderboard {
            padding: 30px;
            background: rgba(15, 23, 42, 0.6);
            backdrop-filter: blur(10px);
        }
        
        .leaderboard-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 25px;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
        }
        
        .leaderboard-table th,
        .leaderboard-table td {
            padding: 18px;
            text-align: left;
            border-bottom: 1px solid rgba(71, 85, 105, 0.3);
        }
        
        .leaderboard-table th {
            background: rgba(30, 41, 59, 0.95);
            font-weight: 600;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            font-size: 12px;
            backdrop-filter: blur(10px);
        }
        
        .leaderboard-table tbody tr {
            background: rgba(15, 23, 42, 0.7);
            transition: all 0.3s ease;
        }
        
        .leaderboard-table tbody tr:hover {
            background: rgba(30, 41, 59, 0.9);
            transform: translateY(-1px);
            box-shadow: 0 4px 16px rgba(71, 85, 105, 0.25);
        }
        
        .rank {
            font-weight: 700;
            font-size: 1.3em;
            background: linear-gradient(135deg, #e2e8f0, #94a3b8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            width: 60px;
        }
        
        .model-name {
            font-weight: 600;
            color: #f1f5f9;
            font-size: 15px;
        }
        
        .win-rate {
            font-weight: 700;
            color: #10b981;
            font-size: 16px;
            text-shadow: 0 0 10px rgba(16, 185, 129, 0.3);
        }
        
        .stats {
            color: #94a3b8;
            font-size: 0.9em;
        }
        
        .guess-distribution {
            display: flex;
            gap: 5px;
            margin-top: 5px;
        }
        
        .guess-bar {
            background: rgba(71, 85, 105, 0.4);
            height: 18px;
            border-radius: 4px;
            min-width: 22px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            color: #64748b;
            border: 1px solid rgba(100, 116, 139, 0.2);
            transition: all 0.3s ease;
        }
        
        .guess-bar.has-data {
            background: linear-gradient(90deg, #475569, #64748b);
            color: #f8fafc;
            border-color: rgba(100, 116, 139, 0.5);
            box-shadow: 0 0 8px rgba(71, 85, 105, 0.4);
            transform: scale(1.05);
        }
        
        .error {
            background: rgba(220, 38, 38, 0.1);
            color: #fca5a5;
            border-left-color: #dc2626;
            border: 1px solid rgba(220, 38, 38, 0.3);
        }
        
        .loading {
            text-align: center;
            padding: 60px;
            color: #94a3b8;
            background: rgba(15, 23, 42, 0.7);
            backdrop-filter: blur(10px);
            border-radius: 12px;
            margin: 20px;
        }
        
        .spinner {
            border: 4px solid rgba(71, 85, 105, 0.3);
            border-top: 4px solid #64748b;
            border-radius: 50%;
            width: 50px;
            height: 50px;
            animation: spin 1s linear infinite;
            margin: 0 auto 25px;
            box-shadow: 0 0 20px rgba(71, 85, 105, 0.4);
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .last-updated {
            text-align: center;
            color: #64748b;
            font-size: 0.9em;
            padding: 25px;
            border-top: 1px solid rgba(71, 85, 105, 0.3);
            background: rgba(15, 23, 42, 0.7);
            backdrop-filter: blur(10px);
        }
        
        /* Mobile Optimizations */
        @media (max-width: 768px) {
            body {
                padding: 10px;
            }
            
            .container {
                margin: 0;
                border-radius: 12px;
            }
            
            .header {
                padding: 25px 20px;
            }
            
            .header h1 {
                font-size: 2em;
                margin-bottom: 10px;
            }
            
            .header p {
                font-size: 1.1em;
            }
            
            .controls {
                flex-direction: column;
                align-items: stretch;
                padding: 15px;
            }
            
            .control-group {
                justify-content: center;
                flex-wrap: wrap;
                gap: 10px;
            }
            
            .btn {
                padding: 16px 24px;
                font-size: 16px;
                min-height: 48px;
                border-radius: 8px;
                width: 100%;
                max-width: 200px;
                white-space: nowrap;
            }
            
            .input {
                padding: 16px;
                font-size: 16px;
                width: 100px;
                min-height: 48px;
                border-radius: 8px;
                text-align: center;
            }
            
            .status {
                margin: 15px;
                padding: 15px;
            }
            
            .leaderboard {
                padding: 15px;
                overflow-x: hidden;
            }
            
            /* Mobile-first table approach */
            .leaderboard-table {
                display: none; /* Hide table on mobile */
            }
            
            .mobile-leaderboard {
                display: block;
            }
            
            .mobile-card {
                background: rgba(15, 23, 42, 0.9);
                border: 1px solid rgba(71, 85, 105, 0.3);
                border-radius: 12px;
                margin-bottom: 15px;
                padding: 20px;
                transition: all 0.3s ease;
                border-left: 4px solid #64748b;
            }
            
            .mobile-card:hover {
                background: rgba(30, 41, 59, 0.95);
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(71, 85, 105, 0.3);
            }
            
            .mobile-card-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 15px;
            }
            
            .mobile-rank {
                font-size: 1.8em;
                font-weight: 700;
                background: linear-gradient(135deg, #e2e8f0, #94a3b8);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                min-width: 50px;
            }
            
            .mobile-model {
                font-size: 1.1em;
                font-weight: 600;
                color: #f1f5f9;
                flex: 1;
                margin: 0 15px;
                text-align: left;
            }
            
            .mobile-winrate {
                font-size: 1.3em;
                font-weight: 700;
                color: #10b981;
                text-shadow: 0 0 10px rgba(16, 185, 129, 0.3);
            }
            
            .mobile-stats {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 15px;
                margin-bottom: 15px;
            }
            
            .mobile-stat {
                text-align: center;
                padding: 10px;
                background: rgba(30, 41, 59, 0.6);
                border-radius: 8px;
                border: 1px solid rgba(100, 116, 139, 0.3);
            }
            
            .mobile-stat-label {
                font-size: 0.8em;
                color: #94a3b8;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 5px;
            }
            
            .mobile-stat-value {
                font-size: 1.1em;
                font-weight: 600;
                color: #f1f5f9;
            }
            
            .mobile-distribution {
                margin-top: 10px;
            }
            
            .mobile-distribution-label {
                font-size: 0.8em;
                color: #94a3b8;
                margin-bottom: 8px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            .mobile-guess-bars {
                display: flex;
                gap: 6px;
                justify-content: space-between;
            }
            
            .mobile-guess-bar {
                flex: 1;
                background: rgba(71, 85, 105, 0.5);
                height: 32px;
                border-radius: 6px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                font-size: 10px;
                color: #64748b;
                border: 1px solid rgba(100, 116, 139, 0.2);
                transition: all 0.3s ease;
            }
            
            .mobile-guess-bar.has-data {
                background: linear-gradient(135deg, #475569, #64748b);
                color: #f8fafc;
                border-color: rgba(100, 116, 139, 0.5);
                box-shadow: 0 0 8px rgba(71, 85, 105, 0.4);
                transform: scale(1.05);
            }
            
            .mobile-guess-number {
                font-size: 8px;
                opacity: 0.7;
                margin-bottom: 2px;
            }
            
            .mobile-guess-count {
                font-size: 11px;
                font-weight: 600;
            }
        }
        
        .view-games-btn {
            background: linear-gradient(135deg, #334155 0%, #475569 100%);
            color: #f1f5f9;
            border: 1px solid rgba(71, 85, 105, 0.4);
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.3s ease;
            margin-top: 5px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }
        
        .view-games-btn:hover {
            background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(71, 85, 105, 0.4);
        }
        
        .mobile-view-btn {
            width: 100%;
            margin-top: 15px;
            padding: 12px;
            font-size: 14px;
        }
        
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.8);
            backdrop-filter: blur(5px);
        }
        
        .modal-content {
            background: linear-gradient(135deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 41, 59, 0.98) 100%);
            border: 1px solid rgba(71, 85, 105, 0.3);
            border-radius: 12px;
            margin: 5% auto;
            padding: 0;
            width: 95%;
            max-width: 800px;
            max-height: 85vh;
            overflow-y: auto;
            box-shadow: 0 20px 40px rgba(0,0,0,0.6);
            backdrop-filter: blur(20px);
        }
        
        .modal-header {
            background: linear-gradient(135deg, rgba(30, 41, 59, 0.9) 0%, rgba(51, 65, 85, 0.7) 100%);
            border-bottom: 1px solid rgba(71, 85, 105, 0.3);
            padding: 20px;
            border-radius: 12px 12px 0 0;
        }
        
        .modal-header h2 {
            margin: 0;
            color: #f1f5f9;
            font-size: 1.5em;
        }
        
        .close {
            color: #94a3b8;
            float: right;
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
            line-height: 1;
        }
        
        .close:hover {
            color: #f1f5f9;
        }
        
        .modal-body {
            padding: 20px;
        }
        
        .game-card {
            background: rgba(30, 41, 59, 0.7);
            border: 1px solid rgba(100, 116, 139, 0.3);
            border-radius: 8px;
            margin-bottom: 15px;
            padding: 15px;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        
        .game-card:hover {
            background: rgba(51, 65, 85, 0.8);
            border-color: rgba(148, 163, 184, 0.4);
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(71, 85, 105, 0.25);
        }
        
        .game-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        
        .game-number {
            font-weight: 600;
            color: #cbd5e1;
        }
        
        .game-result {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
        }
        
        .game-result.won {
            background: rgba(16, 185, 129, 0.2);
            color: #10b981;
            border: 1px solid rgba(16, 185, 129, 0.3);
        }
        
        .game-result.lost {
            background: rgba(220, 38, 38, 0.2);
            color: #dc2626;
            border: 1px solid rgba(220, 38, 38, 0.3);
        }
        
        .game-result.error {
            background: rgba(245, 158, 11, 0.2);
            color: #f59e0b;
            border: 1px solid rgba(245, 158, 11, 0.3);
        }
        
        .game-details {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            font-size: 14px;
            color: #94a3b8;
        }
        
        .game-detail-item {
            display: flex;
            justify-content: space-between;
        }
        
        .guess-sequence {
            display: none;
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid rgba(100, 116, 139, 0.3);
        }
        
        .guess-item {
            display: flex;
            align-items: center;
            margin-bottom: 8px;
            padding: 8px;
            background: rgba(15, 23, 42, 0.7);
            border-radius: 6px;
            border: 1px solid rgba(71, 85, 105, 0.3);
        }
        
        .guess-number {
            width: 30px;
            font-weight: 600;
            color: #64748b;
        }
        
        .guess-word {
            font-family: 'Courier New', monospace;
            font-weight: 700;
            font-size: 16px;
            margin: 0 15px;
            color: #f1f5f9;
        }
        
        .guess-feedback {
            display: flex;
            gap: 2px;
        }
        
        .feedback-letter {
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 3px;
            font-size: 12px;
            font-weight: 700;
            color: white;
        }
        
        .feedback-letter.correct {
            background: #10b981;
        }
        
        .feedback-letter.wrong-position {
            background: #f59e0b;
        }
        
        .feedback-letter.not-in-word {
            background: #6b7280;
        }
        
        @media (max-width: 768px) {
            .modal-content {
                margin: 2% auto;
                width: 98%;
                max-height: 95vh;
            }
            
            .game-details {
                grid-template-columns: 1fr;
            }
        }
        
        /* Desktop view - hide mobile cards */
        @media (min-width: 769px) {
            .mobile-leaderboard {
                display: none;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Wordle Arena</h1>
            <div class="subtitle">LLM Performance Benchmark</div>
            <div class="stats">900 games • 9 models • Live results</div>
        </div>
        

        <div id="status" class="status" style="display: none;"></div>
        
        <div class="leaderboard">
            <div id="loading" class="loading">
                <div class="spinner"></div>
                Loading leaderboard...
            </div>
            <div id="leaderboard-content" style="display: none;"></div>
        </div>
        
        <div id="lastUpdated" class="last-updated" style="display: none;"></div>
    </div>

    <!-- Games Modal -->
    <div id="gamesModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <span class="close">&times;</span>
                <h2 id="modalTitle">Model Games</h2>
            </div>
            <div class="modal-body" id="modalBody">
                <div class="loading">
                    <div class="spinner"></div>
                    Loading games...
                </div>
            </div>
        </div>
    </div>

    <script>
        let refreshInterval;
        
        const formatModel = (model) => {
            return model.replace(/\\//g, ' / ').replace(/-/g, ' ');
        };
        
        const formatPercent = (num) => {
            return num.toFixed(1) + '%';
        };
        
        const createGuessDistribution = (distribution) => {
            const max = Math.max(...Object.values(distribution));
            return Object.entries(distribution).map(([guess, count]) => {
                const width = max > 0 ? Math.max((count / max) * 100, 10) : 10;
                const hasData = count > 0;
                return '<div class="guess-bar ' + (hasData ? 'has-data' : '') + '" style="width: ' + width + 'px;" title="Guess ' + guess + ': ' + count + ' games">' + (count || '') + '</div>';
            }).join('');
        };
        
        const createMobileGuessDistribution = (distribution) => {
            return Object.entries(distribution).map(([guess, count]) => {
                const hasData = count > 0;
                return '<div class="mobile-guess-bar ' + (hasData ? 'has-data' : '') + '" title="Guess ' + guess + ': ' + count + ' games"><div class="mobile-guess-number">' + guess + '</div><div class="mobile-guess-count">' + (count || '0') + '</div></div>';
            }).join('');
        };
        
        const loadLeaderboard = async () => {
            try {
                const response = await fetch('/api/leaderboard');
                const data = await response.json();
                
                if (data.error) {
                    document.getElementById('loading').innerHTML = '<div style="color: #ef4444;"><h3>No Results Available</h3><p>Start an arena competition to see the leaderboard!</p></div>';
                    return;
                }
                
                const content = document.getElementById('leaderboard-content');
                
                // Desktop table view
                const leaderboardRows = data.leaderboard.map((entry, index) => {
                    const modelName = formatModel(entry.model);
                    const winRate = formatPercent(entry.winRate);
                    const avgGuesses = entry.averageGuesses.toFixed(2);
                    const games = entry.wins + 'W / ' + entry.losses + 'L' + (entry.errors > 0 ? ' (' + entry.errors + ' errors)' : '');
                    const distribution = createGuessDistribution(entry.guessDistribution);
                    const modelId = encodeURIComponent(entry.model);
                    
                    return '<tr><td class="rank">#' + (index + 1) + '</td><td class="model-name">' + modelName + '<br><button class="view-games-btn" data-model="' + modelId + '">View Games</button></td><td class="win-rate">' + winRate + '</td><td>' + avgGuesses + '</td><td class="stats">' + games + '</td><td><div class="guess-distribution">' + distribution + '</div></td></tr>';
                }).join('');
                
                // Mobile card view
                const mobileCards = data.leaderboard.map((entry, index) => {
                    const modelName = formatModel(entry.model);
                    const winRate = formatPercent(entry.winRate);
                    const avgGuesses = entry.averageGuesses.toFixed(2);
                    const games = entry.wins + 'W / ' + entry.losses + 'L';
                    const errors = entry.errors > 0 ? entry.errors + ' errors' : 'No errors';
                    const mobileDistribution = createMobileGuessDistribution(entry.guessDistribution);
                    const modelId = encodeURIComponent(entry.model);
                    
                    return '<div class="mobile-card"><div class="mobile-card-header"><div class="mobile-rank">#' + (index + 1) + '</div><div class="mobile-model">' + modelName + '</div><div class="mobile-winrate">' + winRate + '</div></div><div class="mobile-stats"><div class="mobile-stat"><div class="mobile-stat-label">Avg Guesses</div><div class="mobile-stat-value">' + avgGuesses + '</div></div><div class="mobile-stat"><div class="mobile-stat-label">Games</div><div class="mobile-stat-value">' + games + '</div></div></div><div class="mobile-distribution"><div class="mobile-distribution-label">Guess Distribution</div><div class="mobile-guess-bars">' + mobileDistribution + '</div></div><button class="view-games-btn mobile-view-btn" data-model="' + modelId + '">View Games</button></div>';
                }).join('');
                
                content.innerHTML = '<h2>🏆 Current Leaderboard</h2><table class="leaderboard-table"><thead><tr><th>Rank</th><th>Model</th><th>Win Rate</th><th>Avg Guesses</th><th>Games</th><th>Distribution</th></tr></thead><tbody>' + leaderboardRows + '</tbody></table><div class="mobile-leaderboard">' + mobileCards + '</div>';
                
                document.getElementById('loading').style.display = 'none';
                content.style.display = 'block';
                
                // Add event listeners for view games buttons
                document.querySelectorAll('.view-games-btn').forEach(btn => {
                    btn.addEventListener('click', function() {
                        const modelId = this.getAttribute('data-model');
                        showModelGames(modelId);
                    });
                });
                
                const lastUpdated = document.getElementById('lastUpdated');
                lastUpdated.textContent = 'Last updated: ' + data.lastUpdated;
                lastUpdated.style.display = 'block';
                
                if (data.isRunning) {
                    showProgress(data.progress);
                } else {
                    hideProgress();
                }
                
            } catch (error) {
                console.error('Error loading leaderboard:', error);
                document.getElementById('loading').innerHTML = '<div style="color: #ef4444;"><h3>Error Loading Leaderboard</h3><p>Please try refreshing the page.</p></div>';
            }
        };
        
        const showProgress = (progress) => {
            const statusDiv = document.getElementById('status');
            const percentage = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;
            
            statusDiv.innerHTML = '<div><strong>Arena Running...</strong></div><div>Current: ' + (progress.currentModel || 'Initializing...') + '</div><div class="progress"><div class="progress-bar" style="width: ' + percentage + '%">' + progress.completed + '/' + progress.total + ' (' + percentage.toFixed(1) + '%)</div></div>' + (progress.error ? '<div style="color: #ef4444; margin-top: 10px;">Error: ' + progress.error + '</div>' : '');
            statusDiv.style.display = 'block';
            

        };
        
        const hideProgress = () => {
            document.getElementById('status').style.display = 'none';
        };
        
        const startArena = async () => {
            const rounds = parseInt(document.getElementById('rounds').value);
            if (rounds < 1 || rounds > 100) {
                alert('Please enter a number of rounds between 1 and 100.');
                return;
            }
            
            try {
                const response = await fetch('/api/start-arena', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ rounds })
                });
                
                const data = await response.json();
                
                if (data.error) {
                    alert(data.error);
                    return;
                }
                
                refreshInterval = setInterval(loadLeaderboard, 2000);
                
            } catch (error) {
                console.error('Error starting arena:', error);
                alert('Error starting arena. Please try again.');
            }
        };
        

        
        const modal = document.getElementById('gamesModal');
        const closeBtn = document.getElementsByClassName('close')[0];
        
        closeBtn.onclick = function() {
            modal.style.display = 'none';
        };
        
        window.onclick = function(event) {
            if (event.target == modal) {
                modal.style.display = 'none';
            }
        };
        
        const showModelGames = async (modelId) => {
            const modelName = decodeURIComponent(modelId);
            document.getElementById('modalTitle').textContent = formatModel(modelName) + ' - All Games';
            document.getElementById('modalBody').innerHTML = '<div class="loading"><div class="spinner"></div>Loading games...</div>';
            modal.style.display = 'block';
            
            try {
                const response = await fetch('/api/games/' + modelId);
                const data = await response.json();
                
                if (data.error) {
                    document.getElementById('modalBody').innerHTML = '<div style="color: #ef4444; text-align: center; padding: 40px;"><h3>Error Loading Games</h3><p>' + data.error + '</p></div>';
                    return;
                }
                
                const gamesHtml = data.games.map(game => {
                    const resultClass = game.error ? 'error' : (game.won ? 'won' : 'lost');
                    const resultText = game.error ? 'Error' : (game.won ? 'Won in ' + game.guessCount : 'Lost');
                    
                    const guessesHtml = game.guesses.map((guess, index) => {
                        const feedbackHtml = guess.word.split('').map((letter, letterIndex) => {
                            let className = 'not-in-word';
                            
                            // Find the correct classification for this letter
                            if (guess.result.correct.some(c => c.position === letterIndex)) {
                                className = 'correct';
                            } else if (guess.result.wrong_position.some(w => w.position === letterIndex)) {
                                className = 'wrong-position';
                            }
                            
                            return '<div class="feedback-letter ' + className + '">' + letter + '</div>';
                        }).join('');
                        
                        return '<div class="guess-item"><div class="guess-number">' + (index + 1) + '</div><div class="guess-word">' + guess.word + '</div><div class="guess-feedback">' + feedbackHtml + '</div></div>';
                    }).join('');
                    
                    return '<div class="game-card" onclick="toggleGuesses(this)"><div class="game-header"><div class="game-number">Game #' + game.gameNumber + '</div><div class="game-result ' + resultClass + '">' + resultText + '</div></div><div class="game-details"><div class="game-detail-item"><span>Target Word:</span><span style="font-family: monospace; font-weight: bold;">' + game.targetWord + '</span></div><div class="game-detail-item"><span>Guesses:</span><span>' + game.guesses.length + '/6</span></div></div><div class="guess-sequence">' + guessesHtml + '</div></div>';
                }).join('');
                
                document.getElementById('modalBody').innerHTML = '<div style="margin-bottom: 20px; text-align: center; color: #94a3b8;">Click on any game to see the guess sequence</div>' + gamesHtml;
                
            } catch (error) {
                console.error('Error loading games:', error);
                document.getElementById('modalBody').innerHTML = '<div style="color: #ef4444; text-align: center; padding: 40px;"><h3>Error Loading Games</h3><p>Please try again later.</p></div>';
            }
        };
        
        const toggleGuesses = (gameCard) => {
            const guessSequence = gameCard.querySelector('.guess-sequence');
            if (guessSequence.style.display === 'none' || guessSequence.style.display === '') {
                guessSequence.style.display = 'block';
            } else {
                guessSequence.style.display = 'none';
            }
        };
        
        loadLeaderboard();
        
        setInterval(() => {
            if (!refreshInterval) {
                loadLeaderboard();
            }
        }, 30000);
    </script>
</body>
</html>`;
}


console.log(`Server starting on port ${PORT}...`);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 LLM Wordle Arena Server running at http://localhost:${PORT}`);
  console.log(`   Access from any device at http://YOUR_IP:${PORT}`);
});