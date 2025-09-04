function fmtPct(n){ return (n || 0).toFixed(1) + '%'; }
function fmtNum(n){ return (n || 0).toFixed(2); }
function esc(s){ return String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
const BOOT = window.__HUMANS__ || null;

async function load(){
  const status = document.getElementById('status');
  const tbody = document.getElementById('tbody');
  const meta = document.getElementById('meta');
  try {
    status.textContent = 'Loading leaderboard…';
    let data = BOOT;
    if(!data){
      async function getLb(url){
        const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
        const ct = r.headers.get('content-type') || '';
        if(!ct.includes('application/json')) throw new Error('Bad content-type');
        return r.json();
      }
      try { data = await getLb('/api/humans/leaderboard'); }
      catch { data = await getLb('/pvp/api/humans/leaderboard'); }
    }
    if(data.error){
      status.textContent = 'No data available.';
      return;
    }
    status.textContent = '';
    tbody.innerHTML = data.leaderboard.map((p, i) => `
      <tr>
        <td class="rank">#${i+1}</td>
        <td class="name">${esc(p.playerName)}</td>
        <td class="ok">${p.elo ?? 1200}</td>
        <td class="ok">${p.wins}</td>
        <td>${p.losses}</td>
        <td>${fmtPct(p.winRate)}</td>
        <td>${p.games}</td>
        <td class="muted mono">${esc(p.lastPlayed || '')}</td>
      </tr>`).join('');
    meta.textContent = `Players: ${data.count} • Updated: ${new Date(data.lastScan).toLocaleString()}`;
  } catch(e){
    status.textContent = 'Failed to load leaderboard.';
    console.error(e);
  }
}

load();
setInterval(load, 15000);
