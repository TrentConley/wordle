let gameId = null;
let gameState = {
  over: false,
  wonBy: null,
  humanRow: 0,
  llmRow: 0,
  currentGuess: '',
  humanGuesses: [],
  llmGuesses: [],
  guessesRemaining: 6,
  paintedHumanRows: 0,
  paintedLlmRows: 0
};

const statusEl = document.getElementById('status');
const gridHuman = document.getElementById('grid-human');
const gridLlm = document.getElementById('grid-llm');
const messageHuman = document.getElementById('message');
const llmMessage = document.getElementById('llmMessage');
const resetBtn = document.getElementById('reset');
const modelSelect = document.getElementById('model');

// Build two 6x5 grids mirroring @wordle
function buildGrids(){
  gridHuman.innerHTML = '';
  gridLlm.innerHTML = '';
  for(let r=0;r<6;r++){
    const rowH = document.createElement('div'); 
    rowH.className = 'row';
    rowH.dataset.row = r;
    const rowL = document.createElement('div'); 
    rowL.className = 'row';
    rowL.dataset.row = r;
    for(let c=0;c<5;c++){
      const tH = document.createElement('div'); 
      tH.className = 'tile'; 
      tH.dataset.row = r;
      tH.dataset.col = c;
      tH.id = `h-${r}-${c}`; 
      rowH.appendChild(tH);
      
      const tL = document.createElement('div'); 
      tL.className = 'tile'; 
      tL.dataset.row = r;
      tL.dataset.col = c;
      tL.id = `l-${r}-${c}`; 
      rowL.appendChild(tL);
    }
    gridHuman.appendChild(rowH);
    gridLlm.appendChild(rowL);
  }
}

function updateTileDisplay(){
  // Clear current row first
  for(let i = 0; i < 5; i++){
    const tile = document.getElementById(`h-${gameState.humanRow}-${i}`);
    if(tile){
      tile.textContent = '';
      tile.classList.remove('filled');
    }
  }
  
  // Fill with current guess
  for(let i = 0; i < gameState.currentGuess.length; i++){
    const tile = document.getElementById(`h-${gameState.humanRow}-${i}`);
    if(tile){
      tile.textContent = gameState.currentGuess[i];
      tile.classList.add('filled');
    }
  }
}

function paintGuess(prefix, rowIndex, word, result){
  const letters = word.split('');
  
  // Check if this row has already been painted (to avoid re-animating)
  const firstTile = document.getElementById(`${prefix}-${rowIndex}-0`);
  if(firstTile && firstTile.classList.contains('flip')){
    return; // Already painted, skip
  }
  
  // First set all letters
  letters.forEach((ch, i) => {
    const el = document.getElementById(`${prefix}-${rowIndex}-${i}`);
    if(el){
      // Only show letters for human player
      if(prefix === 'h'){
        el.textContent = ch;
      }
      el.classList.add('filled');
      
      // Apply blur to LLM tiles immediately
      if(prefix === 'l'){
        el.classList.add('llm-blurred');
      }
    }
  });
  
  // Then apply flip animation and colors
  setTimeout(() => {
    letters.forEach((ch, i) => {
      const el = document.getElementById(`${prefix}-${rowIndex}-${i}`);
      if(el && !el.classList.contains('flip')){
        el.classList.add('flip');
        
        // Find the correct status for this position
        if(result.correct.some(x => x.position === i)){
          el.classList.add('correct');
        } else if(result.wrong_position.some(x => x.position === i)){
          el.classList.add('present');
        } else {
          el.classList.add('absent');
        }
        
        // Keep blur on LLM tiles
        if(prefix === 'l'){
          el.classList.add('llm-blurred');
        }
      }
    });
  }, 100);
}

async function fetchState(){
  if(!gameId) return;
  
  try {
    const response = await fetch(`/api/pvp/state/${gameId}`);
    const state = await response.json();
    
    // Update local game state
    const prevHumanGuesses = gameState.humanGuesses.length;
    const prevLlmGuesses = gameState.llmGuesses.filter(g => g.word).length;
    
    gameState.over = state.over;
    gameState.wonBy = state.wonBy;
    gameState.humanGuesses = state.humanGuesses || [];
    gameState.llmGuesses = state.llmGuesses || [];
    gameState.humanRow = gameState.humanGuesses.length;
    gameState.llmRow = gameState.llmGuesses.filter(g => g.word).length;
    gameState.guessesRemaining = state.guessesRemaining;
    
    // Only paint new guesses that haven't been painted yet
    for(let i = gameState.paintedHumanRows; i < gameState.humanGuesses.length; i++){
      const g = gameState.humanGuesses[i];
      if(g.word && g.result){
        paintGuess('h', i, g.word, g.result);
        gameState.paintedHumanRows++;
      }
    }
    
    const llmGuessesWithWords = gameState.llmGuesses.filter(g => g.word);
    for(let i = gameState.paintedLlmRows; i < llmGuessesWithWords.length; i++){
      const g = llmGuessesWithWords[i];
      if(g.word && g.result){
        paintGuess('l', i, g.word, g.result);
        gameState.paintedLlmRows++;
      }
    }
    
    // Update current guess display only if needed
    if(gameState.currentGuess.length > 0){
      updateTileDisplay();
    }
    
    // Update status
    if(gameState.over){
      // Only show the target word if both players have finished (lost) or someone won
      const shouldShowWord = gameState.wonBy || (gameState.humanRow >= 6 && gameState.llmRow >= 6);
      statusEl.textContent = `Winner: ${gameState.wonBy || 'None'}${shouldShowWord && state.targetWord ? ' — Word was: ' + state.targetWord : ''}`;
      resetBtn.disabled = false;
      modelSelect.disabled = false;
      
      // Remove blur from LLM tiles when game is over and word should be revealed
      if(shouldShowWord) {
        document.querySelectorAll('.llm-blurred').forEach(tile => {
          tile.classList.remove('llm-blurred');
          if(tile.dataset.row !== undefined && tile.dataset.col !== undefined) {
            const rowIndex = parseInt(tile.dataset.row);
            const colIndex = parseInt(tile.dataset.col);
            // Get the corresponding LLM guess for this row
            const llmGuessesWithWords = gameState.llmGuesses.filter(g => g.word);
            if(llmGuessesWithWords[rowIndex] && llmGuessesWithWords[rowIndex].word) {
              tile.textContent = llmGuessesWithWords[rowIndex].word[colIndex];
            }
          }
        });
      }
    } else {
      statusEl.textContent = `Guesses remaining: ${gameState.guessesRemaining}`;
    }
    
    // Clear any error messages
    if(!gameState.over){
      setTimeout(() => messageHuman.textContent = '', 3000);
    }
  } catch(error) {
    console.error('Error fetching state:', error);
  }
}

async function startGame(){
  try {
    const model = modelSelect.value;
    const response = await fetch('/api/pvp/start', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({model})
    });
    
    if(!response.ok){
      throw new Error('Failed to start game');
    }
    
    const data = await response.json();
    gameId = data.id;
    
    // Reset game state
    gameState = {
      over: false,
      wonBy: null,
      humanRow: 0,
      llmRow: 0,
      currentGuess: '',
      humanGuesses: [],
      llmGuesses: [],
      guessesRemaining: 6,
      paintedHumanRows: 0,
      paintedLlmRows: 0
    };
    
    statusEl.textContent = `Game #${gameId} started`;
    messageHuman.textContent = '';
    llmMessage.textContent = '';
    
    buildGrids();
    buildKeyboard();
    
    modelSelect.disabled = true;
    resetBtn.disabled = false;
    
    fetchState();
  } catch(error) {
    console.error('Error starting game:', error);
    messageHuman.textContent = 'Failed to start game';
  }
}

resetBtn.onclick = () => {
  startGame();
};

function buildKeyboard(){
  const keyboard = document.getElementById('keyboard');
  keyboard.innerHTML = '';
  const rows = [
    ['Q','W','E','R','T','Y','U','I','O','P'],
    ['A','S','D','F','G','H','J','K','L'],
    ['ENTER','Z','X','C','V','B','N','M','BACKSPACE']
  ];
  
  rows.forEach(keys => {
    const row = document.createElement('div');
    row.className = 'keyboard-row';
    keys.forEach(k => {
      const key = document.createElement('button');
      key.className = 'key ' + (k.length > 1 ? 'wide' : 'letter');
      key.textContent = k === 'BACKSPACE' ? '⌫' : k;
      key.dataset.key = k;
      key.addEventListener('click', () => onKey(k));
      row.appendChild(key);
    });
    keyboard.appendChild(row);
  });
}

function onKey(key){
  if(!gameId || gameState.over) return;
  
  if(key === 'ENTER'){
    submitGuess();
  } else if(key === 'BACKSPACE'){
    if(gameState.currentGuess.length > 0){
      gameState.currentGuess = gameState.currentGuess.slice(0, -1);
      updateTileDisplay();
    }
  } else if(/^[A-Z]$/.test(key) && gameState.currentGuess.length < 5){
    gameState.currentGuess += key;
    updateTileDisplay();
  }
}

async function submitGuess(){
  if(gameState.currentGuess.length !== 5){
    messageHuman.textContent = 'Not enough letters';
    // Add shake animation
    const currentRowEl = gridHuman.children[gameState.humanRow];
    if(currentRowEl){
      currentRowEl.classList.add('shake');
      setTimeout(() => currentRowEl.classList.remove('shake'), 500);
    }
    return;
  }
  
  const word = gameState.currentGuess;
  gameState.currentGuess = '';
  updateTileDisplay(); // Clear the display immediately
  
  try {
    const response = await fetch(`/api/pvp/guess/${gameId}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({word})
    });
    
    if(!response.ok){
      const error = await response.json();
      messageHuman.textContent = error.error || 'Invalid guess';
      gameState.currentGuess = word; // Restore the guess
      updateTileDisplay();
      return;
    }
    
    // Increment humanRow immediately to prepare for next guess
    gameState.humanRow++;
    
    // Fetch updated state immediately and after animations
    await fetchState();
    setTimeout(fetchState, 1000);
  } catch(error) {
    console.error('Error submitting guess:', error);
    messageHuman.textContent = 'Error submitting guess';
    gameState.currentGuess = word; // Restore the guess
    updateTileDisplay();
  }
}

// Handle keyboard input
document.addEventListener('keydown', (e) => {
  if(e.ctrlKey || e.metaKey || e.altKey) return;
  
  const key = e.key.toUpperCase();
  if(key === 'ENTER'){
    e.preventDefault();
    onKey('ENTER');
  } else if(key === 'BACKSPACE'){
    e.preventDefault();
    onKey('BACKSPACE');
  } else if(/^[A-Z]$/.test(key)){
    e.preventDefault();
    onKey(key);
  }
});

// Initialize
buildGrids();
buildKeyboard();
startGame();

// Periodic state sync
setInterval(() => {
  if(gameId && !gameState.over){
    fetchState();
  }
}, 2500);

