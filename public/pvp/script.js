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
  paintedLlmRows: 0,
  lastLlmErrorShownAt: null
};
// Track startup so user can type before game id is set
let startingGame = false;

const statusEl = document.getElementById('status');
const gridHuman = document.getElementById('grid-human');
const gridLlm = document.getElementById('grid-llm');
const messageHuman = document.getElementById('message');
const llmMessage = document.getElementById('llmMessage');
const resetBtn = document.getElementById('reset');
const modelSelect = document.getElementById('model');
const playerNameInput = document.getElementById('playerName');
const myNameHeader = document.getElementById('myNameHeader');
const llmNameHeader = document.getElementById('llmNameHeader');
const nameModal = document.getElementById('nameModal');
const nameSubmit = document.getElementById('nameSubmit');
const nameError = document.getElementById('nameError');

// Keyboard status tracking for greying/highlighting keys
const keyboardKeys = {}; // map: letter -> button element
function setKeyStatus(letter, status){
  letter = String(letter || '').toUpperCase();
  const el = keyboardKeys[letter];
  if(!el) return;
  const isCorrect = el.classList.contains('correct');
  const isPresent = el.classList.contains('present');
  const isAbsent = el.classList.contains('absent');
  if(status === 'correct'){
    if(!isCorrect){ el.classList.remove('present','absent'); el.classList.add('correct'); }
  } else if(status === 'present'){
    if(!isCorrect && !isPresent){ el.classList.remove('absent'); el.classList.add('present'); }
  } else if(status === 'absent'){
    if(!isCorrect && !isPresent && !isAbsent){ el.classList.add('absent'); }
  }
}

function updateKeyboardFromGuesses(guesses){
  try{
    (guesses||[]).forEach(g=>{
      if(!g || !g.word || !g.result) return;
      const letters = g.word.split('');
      for(let i=0;i<letters.length;i++){
        const letter = letters[i];
        if(g.result.correct && g.result.correct.some(x=>x.position===i)){
          setKeyStatus(letter,'correct');
        } else if(g.result.wrong_position && g.result.wrong_position.some(x=>x.position===i)){
          setKeyStatus(letter,'present');
        } else {
          setKeyStatus(letter,'absent');
        }
      }
    });
  }catch{}
}
// Confetti utilities
let confettiTimer=null;
function startConfetti(durationMs=3000){ const c=document.getElementById('confetti'); if(!c) return; const ctx=c.getContext('2d'); const W=c.width=window.innerWidth,H=c.height=window.innerHeight; const N=160,parts=[]; for(let i=0;i<N;i++) parts.push({x:Math.random()*W,y:Math.random()*-H,vx:(Math.random()-0.5)*2,vy:Math.random()*3+2,c:`hsl(${Math.random()*360},90%,60%)`,s:3+Math.random()*4}); let run=true; (function tick(){ if(!run) return; ctx.clearRect(0,0,W,H); parts.forEach(p=>{p.x+=p.vx;p.y+=p.vy; if(p.y>H){p.y=-10;p.x=Math.random()*W;} ctx.fillStyle=p.c; ctx.fillRect(p.x,p.y,p.s,p.s*0.6);}); requestAnimationFrame(tick); })(); clearTimeout(confettiTimer); confettiTimer=setTimeout(()=>{run=false;ctx.clearRect(0,0,W,H);},durationMs); }
function flash(type){ const d=document.createElement('div'); d.className=(type==='win'?'win-flash':'lose-flash'); document.body.appendChild(d); setTimeout(()=>d.remove(),1200); }

function nameModalVisible(){
  return nameModal && nameModal.style.display !== 'none';
}

function getOrCreatePlayerId(){
  let id = localStorage.getItem('playerId');
  if(!id){
    id = 'p_' + Math.random().toString(36).slice(2,10) + Math.random().toString(36).slice(2,6);
    localStorage.setItem('playerId', id);
  }
  return id;
}

function initPlayerName(){
  const saved = localStorage.getItem('playerName') || '';
  if(playerNameInput){
    playerNameInput.value = saved;
    playerNameInput.addEventListener('input', () => {
      localStorage.setItem('playerName', playerNameInput.value.trim());
    });
  }
  if(myNameHeader){ myNameHeader.textContent = saved || 'You'; }
}

async function checkNameAvailability(name, playerId){
  const params = new URLSearchParams({ name: name || '', playerId: playerId || '' });
  const endpoints = [
    `/api/humans/check-name?${params.toString()}`,
    `/pvp/api/humans/check-name?${params.toString()}`
  ];
  for(const url of endpoints){
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        // Non-JSON (likely proxy rewrite). Try next endpoint.
        continue;
      }
      const data = await res.json();
      return data;
    } catch(e) {
      // try next endpoint
    }
  }
  // As a last resort, allow play rather than blocking
  return { available: true, reason: 'offline-allow' };
}

function showNameModal(message){
  if(nameModal){
    nameModal.style.display = 'flex';
    if(nameError) nameError.textContent = message || '';
    // Load current saved name
    const saved = localStorage.getItem('playerName') || '';
    if(playerNameInput) playerNameInput.value = saved;
    setTimeout(() => playerNameInput?.focus(), 50);
  }
}

function hideNameModal(){
  if(nameModal){
    nameModal.style.display = 'none';
    if(nameError) nameError.textContent = '';
  }
}

async function loadModels(){
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    const list = Array.isArray(data.models) && data.models.length ? data.models : [
      { id: 'openai/gpt-5-chat' },
      { id: 'anthropic/claude-3.5-sonnet' },
      { id: 'openai/gpt-4o' }
    ];
    modelSelect.innerHTML = '';
    const savedModel = localStorage.getItem('pvpModel');
    for(const m of list){
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.id.replace(/\//, ' / ');
      modelSelect.appendChild(opt);
    }
    if(savedModel && list.some(m => m.id === savedModel)){
      modelSelect.value = savedModel;
    }
    modelSelect.addEventListener('change', () => {
      localStorage.setItem('pvpModel', modelSelect.value);
      if(llmNameHeader){ llmNameHeader.textContent = modelSelect.value.replace(/\//,' / '); }
    });
  } catch(e){
    // fallback to defaults if API fails
    modelSelect.innerHTML = `
      <option value="openai/gpt-5-chat">openai / gpt-5-chat</option>
      <option value="anthropic/claude-3.5-sonnet">anthropic / claude-3.5-sonnet</option>
      <option value="openai/gpt-4o">openai / gpt-4o</option>`;
    const savedModel = localStorage.getItem('pvpModel');
    if(savedModel){
      modelSelect.value = savedModel;
    }
    modelSelect.addEventListener('change', () => {
      localStorage.setItem('pvpModel', modelSelect.value);
      if(llmNameHeader){ llmNameHeader.textContent = modelSelect.value.replace(/\//,' / '); }
    });
  }
}

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
    async function getState(url){
      const r = await fetch(url);
      const ct = r.headers.get('content-type') || '';
      if(!ct.includes('application/json')) throw new Error('Bad content-type');
      return r.json();
    }
    let state;
    try {
      state = await getState(`/api/pvp/state/${gameId}`);
    } catch {
      state = await getState(`/pvp/api/pvp/state/${gameId}`);
    }
    
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
    
    // Update keyboard based on human guesses after painting
    try { updateKeyboardFromGuesses(gameState.humanGuesses); } catch {}
    // Update current guess display only if needed
    if(gameState.currentGuess.length > 0){
      updateTileDisplay();
    }

    // Surface LLM errors, if any
    const lastLlmEntry = gameState.llmGuesses[gameState.llmGuesses.length - 1];
    if(lastLlmEntry && lastLlmEntry.error){
      const lastTs = lastLlmEntry.timestamp || String(gameState.llmGuesses.length);
      if(gameState.lastLlmErrorShownAt !== lastTs){
        llmMessage.textContent = `LLM error: ${lastLlmEntry.error}. Try a different model.`;
        gameState.lastLlmErrorShownAt = lastTs;
      }
    } else if (!lastLlmEntry) {
      llmMessage.textContent = '';
    }
    
    // Update status
    if(gameState.over){
      // Only show the target word if both players have finished (lost) or someone won
      const shouldShowWord = gameState.wonBy || (gameState.humanRow >= 6 && gameState.llmRow >= 6);
      statusEl.textContent = `Winner: ${gameState.wonBy || 'None'}${shouldShowWord && state.targetWord ? ' — Word was: ' + state.targetWord : ''}`;
      resetBtn.disabled = false;
      modelSelect.disabled = false;
      // Win / Lose animations
      if(!gameState.animPlayed){
        if(gameState.wonBy==='human'){ startConfetti(3000); flash('win'); }
        else { flash('lose'); }
        gameState.animPlayed = true;
      }
      
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
    // Ensure name gate passed
    const playerId = getOrCreatePlayerId();
    const proposedName = (playerNameInput?.value || localStorage.getItem('playerName') || '').trim();
    if(!proposedName){
      showNameModal('Please enter a name.');
      return;
    }
    const chk = await checkNameAvailability(proposedName, playerId);
    if(!chk.available){
      showNameModal(chk.reason || 'Name unavailable. Choose another.');
      return;
    }
    // Persist name and hide modal
    localStorage.setItem('playerName', proposedName);
    hideNameModal();

    const model = modelSelect.value;
    localStorage.setItem('pvpModel', model);
    const playerName = proposedName;
    async function postStart(url){
      return fetch(url, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ model, playerId, playerName }) });
    }
    let response = await postStart('/api/pvp/start');
    if(!response.ok){
      response = await postStart('/pvp/api/pvp/start');
    }
    if(llmNameHeader){ llmNameHeader.textContent = model.replace(/\//,' / '); }
    
    if(!response.ok){
      throw new Error('Failed to start game');
    }
    
    const data = await response.json();
    gameId = data.id;
    startingGame = false;
    
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
      paintedLlmRows: 0,
      lastLlmErrorShownAt: null
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
      if(k.length===1){ keyboardKeys[k] = key; }
      row.appendChild(key);
    });
    keyboard.appendChild(row);
  });
}

function onKey(key){
  if(gameState.over) return;
  const canType = gameId || startingGame;
  if(!canType) return;
  
  if(key === 'ENTER'){
    if(gameId){ submitGuess(); }
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
    async function postGuess(url){
      return fetch(url, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({word}) });
    }
    let response = await postGuess(`/api/pvp/guess/${gameId}`);
    if(!response.ok){
      response = await postGuess(`/pvp/api/pvp/guess/${gameId}`);
    }
    
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
  // If name modal is open, allow typing only into its input
  if (nameModalVisible()) {
    const t = e.target;
    if (!(t && t.id === 'playerName')) {
      return;
    }
  }
  // If the user is typing in an input/textarea or contenteditable element, don't hijack keys
  const t = e.target;
  if (t && ((t.tagName === 'INPUT') || (t.tagName === 'TEXTAREA') || t.isContentEditable)) {
    return;
  }
  if(e.ctrlKey || e.metaKey || e.altKey) return;
  // allow typing during startup (startingGame) and once gameId exists
  if(!gameId && !startingGame) return;
  
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

// Initialize and auto-start when ready
buildGrids();
buildKeyboard();
initPlayerName();

let modelsLoaded = false;
let triedAutoStart = false;
function autoStartIfReady(){
  if(triedAutoStart) return;
  const hasName = !!(localStorage.getItem('playerName') || '').trim();
  if(modelsLoaded && hasName){
    triedAutoStart = true;
    hideNameModal();
    statusEl.textContent = 'Starting game...';
    startingGame = true;
    setTimeout(() => startGame(), 10);
  }
}

loadModels().then(() => {
  modelsLoaded = true;
  const hasName = !!(localStorage.getItem('playerName') || '').trim();
  statusEl.textContent = hasName ? 'Starting game...' : 'Enter your name to begin.';
  autoStartIfReady();
});

// Periodic state sync
setInterval(() => {
  if(gameId && !gameState.over){
    fetchState();
  }
}, 2500);

// Name modal interactions
if(nameSubmit){
  nameSubmit.addEventListener('click', async () => {
    const pid = getOrCreatePlayerId();
    const name = (playerNameInput?.value || '').trim();
    if(!name){ if(nameError) nameError.textContent = 'Please enter a name.'; return; }
    try {
      const chk = await checkNameAvailability(name, pid);
      if(!chk.available){
        if(nameError) nameError.textContent = chk.reason || 'Name unavailable. Choose another.';
        return;
      }
      localStorage.setItem('playerName', name);
      hideNameModal();
      statusEl.textContent = 'Starting game...';
      if(modelsLoaded){
        startingGame = true;
        // Start immediately so the player can type
        setTimeout(() => startGame(), 10);
      } else {
        triedAutoStart = false;
        startingGame = true;
      }
    } catch(e){
      if(nameError) nameError.textContent = 'Error checking name. Try again.';
    }
  });
}

// Submit on Enter key in name input
if(playerNameInput){
  playerNameInput.addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){
      e.preventDefault();
      nameSubmit?.click();
    }
  });
}

// Show modal on load if missing/invalid
(async function gateOnLoad(){
  const pid = getOrCreatePlayerId();
  const name = (localStorage.getItem('playerName') || '').trim();
  if(!name){
    showNameModal('Please enter a unique name to play.');
    return;
  }
  try {
    const chk = await checkNameAvailability(name, pid);
    if(!chk.available){
      showNameModal('This name is taken by someone else. Pick another.');
    } else { autoStartIfReady(); }
  } catch {}
})();
