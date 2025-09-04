let matchId = null;
let playerId = null;
let gameState = {
  over: false,
  winnerId: null,
  myRow: 0,
  oppRow: 0,
  currentGuess: '',
  paintedMyRows: 0,
  paintedOppRows: 0
};

const statusEl = document.getElementById('status');
const gridHuman = document.getElementById('grid-human');
const gridOpp = document.getElementById('grid-opponent');
const messageHuman = document.getElementById('message');
const oppMessage = document.getElementById('oppMessage');
const nameModal = document.getElementById('nameModal');
const nameSubmit = document.getElementById('nameSubmit');
const nameError = document.getElementById('nameError');
const playerNameInput = document.getElementById('playerName');
const myNameHeader = document.getElementById('myNameHeader');
const oppNameHeader = document.getElementById('oppNameHeader');

function getOrCreatePlayerId(){
  let id = localStorage.getItem('playerId');
  if(!id){ id = 'p_' + Math.random().toString(36).slice(2,10) + Math.random().toString(36).slice(2,6); localStorage.setItem('playerId', id); }
  return id;
}

function showNameModal(msg){
  if(nameModal){ nameModal.style.display = 'flex'; if(nameError) nameError.textContent = msg || ''; setTimeout(()=>playerNameInput?.focus(), 50); }
}
function hideNameModal(){ if(nameModal){ nameModal.style.display = 'none'; if(nameError) nameError.textContent = ''; } }

function buildGrids(){
  gridHuman.innerHTML = '';
  gridOpp.innerHTML = '';
  for(let r=0;r<6;r++){
    const rowH = document.createElement('div'); rowH.className='row'; rowH.dataset.row=r;
    const rowO = document.createElement('div'); rowO.className='row'; rowO.dataset.row=r;
    for(let c=0;c<5;c++){
      const tH = document.createElement('div'); tH.className='tile'; tH.dataset.row=r; tH.dataset.col=c; tH.id=`h-${r}-${c}`; rowH.appendChild(tH);
      const tO = document.createElement('div'); tO.className='tile'; tO.dataset.row=r; tO.dataset.col=c; tO.id=`o-${r}-${c}`; rowO.appendChild(tO);
    }
    gridHuman.appendChild(rowH);
    gridOpp.appendChild(rowO);
  }
}

function updateTileDisplay(){
  for(let i=0;i<5;i++){ const t=document.getElementById(`h-${gameState.myRow}-${i}`); if(t){ t.textContent=''; t.classList.remove('filled'); } }
  for(let i=0;i<gameState.currentGuess.length;i++){ const t=document.getElementById(`h-${gameState.myRow}-${i}`); if(t){ t.textContent=gameState.currentGuess[i]; t.classList.add('filled'); } }
}

function paintGuess(prefix, rowIndex, word, result){
  const letters = word.split('');
  const firstTile = document.getElementById(`${prefix}-${rowIndex}-0`);
  if(firstTile && firstTile.classList.contains('flip')) return;
  letters.forEach((ch,i)=>{
    const el = document.getElementById(`${prefix}-${rowIndex}-${i}`);
    if(!el) return;
    // Always set letter; opponent tiles stay hidden via .llm-blurred until reveal
    el.textContent = ch;
    el.classList.add('filled');
    if(prefix==='o') el.classList.add('llm-blurred');
  });
  setTimeout(()=>{
    letters.forEach((ch,i)=>{
      const el = document.getElementById(`${prefix}-${rowIndex}-${i}`);
      if(!el || el.classList.contains('flip')) return;
      el.classList.add('flip');
      if(result.correct.some(x=>x.position===i)) el.classList.add('correct');
      else if(result.wrong_position.some(x=>x.position===i)) el.classList.add('present');
      else el.classList.add('absent');
      if(prefix==='o') el.classList.add('llm-blurred');
    });
  },100);
}

async function fetchState(){
  if(!matchId) return;
  try {
    const r = await fetch(`/api/h2h/state/${matchId}`);
    const s = await r.json();
    gameState.over = s.over;
    gameState.winnerId = s.winnerId;
    const mySide = (s.players.a.id===playerId) ? 'a' : 'b';
    const oppSide = mySide==='a' ? 'b' : 'a';
    if(myNameHeader){ myNameHeader.textContent = s.players[mySide].name || (localStorage.getItem('playerName')||'You'); }
    if(oppNameHeader){ oppNameHeader.textContent = s.players[oppSide].name || 'Opponent'; }
    const myGuesses = s.guesses[mySide]||[];
    const oppGuesses = s.guesses[oppSide]||[];
    gameState.myRow = myGuesses.length;
    gameState.oppRow = oppGuesses.length;
    for(let i=gameState.paintedMyRows;i<myGuesses.length;i++){ const g=myGuesses[i]; if(g.word&&g.result){ paintGuess('h', i, g.word, g.result); gameState.paintedMyRows++; } }
    for(let i=gameState.paintedOppRows;i<oppGuesses.length;i++){ const g=oppGuesses[i]; if(g.word&&g.result){ paintGuess('o', i, g.word, g.result); gameState.paintedOppRows++; } }
    updateKeyboardFromMyGuesses(myGuesses);
    if(gameState.currentGuess.length>0) updateTileDisplay();
    if(gameState.over){
      // Compute and show the actual winner name so both players see who won
      let winnerName = 'None';
      if (s.winnerId) {
        winnerName = (s.players.a.id === s.winnerId) ? (s.players.a.name || 'Player A') : (s.players.b.name || 'Player B');
      }
      statusEl.textContent = `Winner: ${winnerName}${s.targetWord? ' — Word was: '+s.targetWord: ''}`;
      if(s.targetWord){
        // Reveal opponent letters: remove blur and re-flip opponent tiles for a reveal effect
        document.querySelectorAll('.llm-blurred').forEach(t=>t.classList.remove('llm-blurred'));
        const mySide = (s.players.a.id===playerId) ? 'a' : 'b';
        const oppSide = mySide==='a' ? 'b' : 'a';
        const oppGuesses2 = s.guesses[oppSide] || [];
        oppGuesses2.forEach((g, r)=>{
          if(!g || !g.word) return;
          const letters = g.word.split('');
          letters.forEach((ch,c)=>{
            const el=document.getElementById(`o-${r}-${c}`);
            if(!el) return;
            el.textContent = ch;
            // retrigger flip animation for reveal
            el.classList.remove('flip');
            void el.offsetWidth; // reflow
            el.classList.add('flip');
          });
        });
      }
      if(!gameState.animPlayed){
        if(gameState.winnerId===playerId){ startConfetti(3000); flash('win'); }
        else { flash('lose'); }
        const rq=document.getElementById('requeue'); if(rq){ rq.disabled=false; }
        gameState.animPlayed = true;
      }
    } else {
      statusEl.textContent = `You: ${gameState.myRow}/6 • Opponent: ${gameState.oppRow}/6`;
    }
  } catch(e){ console.error(e); }
}

async function joinQueue(){
  statusEl.textContent = 'Matching you with an opponent…';
  try {
    const name = (localStorage.getItem('playerName')||'').trim();
    const r = await fetch('/api/h2h/join', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId, playerName: name }) });
    const d = await r.json();
    if(d.status==='matched'){ initMatch(d.matchId); return; }
    if(d.status==='waiting'){
      const posStr = d.position? ` (position ${d.position}/${d.queueSize})` : '';
      statusEl.textContent = `Waiting in queue${posStr}…`;
    }
    const iv = setInterval(async ()=>{
      try {
        const rr = await fetch(`/api/h2h/match-for/${playerId}`); const dd = await rr.json();
        if(dd.status==='matched'){ clearInterval(iv); initMatch(dd.matchId); return; }
        const qs = await fetch(`/api/h2h/queue?playerId=${encodeURIComponent(playerId)}`); const qd = await qs.json();
        const posStr2 = qd.position? ` (position ${qd.position}/${qd.queueSize})` : '';
        statusEl.textContent = `Waiting in queue${posStr2}…`;
      } catch{}
    }, 1500);
  } catch(e){ statusEl.textContent = 'Queue error. Retrying…'; setTimeout(joinQueue, 1500); }
}

function initMatch(id){
  matchId = id;
  gameState = { over:false, winnerId:null, myRow:0, oppRow:0, currentGuess:'', paintedMyRows:0, paintedOppRows:0 };
  buildGrids(); buildKeyboard(); fetchState();
  setInterval(()=>{ if(matchId && !gameState.over) fetchState(); }, 2000);
  statusEl.textContent = 'Match started! Type your guess.';
}

function buildKeyboard(){
  const keyboard = document.getElementById('keyboard');
  keyboard.innerHTML = '';
  window._h2hKeys = {};
  const rows = [ ['Q','W','E','R','T','Y','U','I','O','P'], ['A','S','D','F','G','H','J','K','L'], ['ENTER','Z','X','C','V','B','N','M','BACKSPACE'] ];
  rows.forEach(keys=>{
    const row = document.createElement('div'); row.className='keyboard-row';
    keys.forEach(k=>{ const key=document.createElement('button'); key.className='key ' + (k.length>1?'wide':'letter'); key.textContent=(k==='BACKSPACE'?'⌫':k); key.dataset.key=k; key.addEventListener('click', ()=>onKey(k)); if(k.length===1){ window._h2hKeys[k]=key; } row.appendChild(key); });
    keyboard.appendChild(row);
  });
}

function h2hSetKeyStatus(letter, status){
  letter=String(letter||'').toUpperCase(); const el=window._h2hKeys&&window._h2hKeys[letter]; if(!el) return;
  const isC=el.classList.contains('correct'); const isP=el.classList.contains('present'); const isA=el.classList.contains('absent');
  if(status==='correct'){ if(!isC){ el.classList.remove('present','absent'); el.classList.add('correct'); } }
  else if(status==='present'){ if(!isC && !isP){ el.classList.remove('absent'); el.classList.add('present'); } }
  else if(status==='absent'){ if(!isC && !isP && !isA){ el.classList.add('absent'); } }
}

function updateKeyboardFromMyGuesses(guesses){
  try{ (guesses||[]).forEach(g=>{ if(!g||!g.word||!g.result) return; const letters=g.word.split(''); for(let i=0;i<letters.length;i++){ const L=letters[i]; if(g.result.correct.some(x=>x.position===i)) h2hSetKeyStatus(L,'correct'); else if(g.result.wrong_position.some(x=>x.position===i)) h2hSetKeyStatus(L,'present'); else h2hSetKeyStatus(L,'absent'); } }); }catch{}
}

function onKey(key){
  if(gameState.over || !matchId) return;
  if(key==='ENTER'){
    submitGuess();
  } else if(key==='BACKSPACE'){
    if(gameState.currentGuess.length>0){ gameState.currentGuess = gameState.currentGuess.slice(0,-1); updateTileDisplay(); }
  } else if(/^[A-Z]$/.test(key) && gameState.currentGuess.length<5){
    gameState.currentGuess += key; updateTileDisplay();
  }
}

async function submitGuess(){
  if(!matchId) return;
  if(gameState.currentGuess.length!==5){ messageHuman.textContent='Not enough letters'; return; }
  const word = gameState.currentGuess; gameState.currentGuess=''; updateTileDisplay();
  try {
    const r = await fetch(`/api/h2h/guess/${matchId}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerId, word }) });
    if(!r.ok){ const e=await r.json(); messageHuman.textContent = e.error || 'Invalid guess'; gameState.currentGuess=word; updateTileDisplay(); return; }
    await fetchState();
  } catch(e){ console.error(e); messageHuman.textContent='Error submitting guess'; gameState.currentGuess=word; updateTileDisplay(); }
}

document.addEventListener('keydown', (e)=>{
  if(e.ctrlKey||e.metaKey||e.altKey) return;
  const t=e.target; if(t && (t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable)) return;
  const key=e.key.toUpperCase();
  if(key==='ENTER'){ e.preventDefault(); onKey('ENTER'); }
  else if(key==='BACKSPACE'){ e.preventDefault(); onKey('BACKSPACE'); }
  else if(/^[A-Z]$/.test(key)){ e.preventDefault(); onKey(key); }
});

if(nameSubmit){
  nameSubmit.addEventListener('click', async ()=>{
    const name = (playerNameInput?.value || '').trim();
    if(!name){ if(nameError) nameError.textContent='Please enter a name.'; return; }
    try {
      const chk = await fetch(`/api/humans/check-name?name=${encodeURIComponent(name)}&playerId=${encodeURIComponent(playerId)}`);
      const d = await chk.json();
      if(!d.available){ if(nameError) nameError.textContent = d.reason||'Name unavailable.'; return; }
      localStorage.setItem('playerName', name);
      hideNameModal();
      joinQueue();
    } catch { if(nameError) nameError.textContent='Error checking name.'; }
  });
}
if(playerNameInput){ playerNameInput.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ e.preventDefault(); nameSubmit?.click(); } }); }
// Simple confetti animation
let confettiTimer = null;
function startConfetti(durationMs=3000){
  const canvas = document.getElementById('confetti');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width = window.innerWidth;
  const H = canvas.height = window.innerHeight;
  const N = 160; const parts = [];
  for(let i=0;i<N;i++) parts.push({x:Math.random()*W,y:Math.random()*-H,vx:(Math.random()-0.5)*2,vy:Math.random()*3+2,c:`hsl(${Math.random()*360},90%,60%)`,s:3+Math.random()*4});
  let running = true;
  function tick(){
    if(!running) return; ctx.clearRect(0,0,W,H);
    parts.forEach(p=>{ p.x+=p.vx; p.y+=p.vy; if(p.y>H){ p.y=-10; p.x=Math.random()*W; } ctx.fillStyle=p.c; ctx.fillRect(p.x,p.y,p.s,p.s*0.6); });
    requestAnimationFrame(tick);
  }
  tick();
  clearTimeout(confettiTimer); confettiTimer = setTimeout(()=>{ running=false; ctx.clearRect(0,0,W,H); }, durationMs);
}
function flash(type){
  const div=document.createElement('div');
  div.className = type==='win'?'win-flash':'lose-flash';
  document.body.appendChild(div);
  setTimeout(()=>div.remove(),1200);
}


playerId = getOrCreatePlayerId();
const savedName = (localStorage.getItem('playerName')||'').trim();
buildGrids(); buildKeyboard();
if(!savedName){ showNameModal('Enter a unique name to play.'); }
else { joinQueue(); }

// Requeue button
const rqBtn = document.getElementById('requeue');
if(rqBtn){ rqBtn.addEventListener('click', ()=>{ matchId=null; statusEl.textContent='Matching you with an opponent…'; rqBtn.disabled=true; joinQueue(); }); }
