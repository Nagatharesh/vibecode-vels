/* ============================================================
   script.js — AdaptLB Adaptive Load Balancer Simulator
   All simulator logic, state management, and DOM rendering
============================================================ */

/* ============================================================
   1. STATE
============================================================ */
const state = {
  servers: [],
  algo: 'Least Load',
  reqType: 'normal',
  sessions: {},
  loggedUsers: {},
  rrIndex: 0,
  totalReqs: 0,
  droppedReqs: 0,
  autoMode: false,
  autoInterval: null,
  loadHistory: {},
};

/* ============================================================
   2. SERVER FACTORY
============================================================ */
function createServer(id) {
  return {
    id,
    name: `SRV-${String(id).padStart(2, '0')}`,
    cpu: Math.random() * 25 + 5,
    mem: Math.random() * 35 + 15,
    connections: 0,
    status: 'healthy',
    weight: Math.floor(Math.random() * 3) + 1,
    totalHandled: 0,
    lastLatency: 0,
    sleeping: false,
  };
}

/* ============================================================
   3. BOOT
============================================================ */
function boot() {
  for (let i = 1; i <= 4; i++) {
    state.servers.push(createServer(i));
    state.loadHistory[i] = [];
  }
  renderAlgoComparison();
  setInterval(tickServers, 1200);
}

/* ============================================================
   4. SERVER TICK
============================================================ */
function tickServers() {
  state.servers.forEach(s => {
    if (s.status === 'down' || s.sleeping) return;

    s.cpu = Math.max(3, s.cpu + (Math.random() - 0.52) * 4);
    s.mem = Math.max(8, s.mem + (Math.random() - 0.51) * 2);
    s.cpu = Math.min(98, s.cpu);
    s.mem = Math.min(98, s.mem);

    if (s.cpu > 85)      s.status = 'overloaded';
    else if (s.cpu > 62) s.status = 'busy';
    else                  s.status = 'healthy';

    state.loadHistory[s.id].push(s.cpu);
    if (state.loadHistory[s.id].length > 8) {
      state.loadHistory[s.id].shift();
    }
  });

  renderServers();
  renderDistribution();
  updateTopBar();
}

/* ============================================================
   5. LOAD PREDICTION — Sliding Window
============================================================ */
function isPredictedOverload(serverId) {
  const history = state.loadHistory[serverId] || [];
  if (history.length < 6) return false;

  const half = Math.floor(history.length / 2);
  const firstHalfAvg = history.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const secondHalfAvg = history.slice(half).reduce((a, b) => a + b, 0) / (history.length - half);

  return (secondHalfAvg - firstHalfAvg) > 10;
}

/* ============================================================
   6. ROUTING ALGORITHMS
============================================================ */
function pickServer(userId = null) {
  const active = state.servers.filter(s => s.status !== 'down' && !s.sleeping);
  if (!active.length) return null;

  switch (state.algo) {

    case 'Round Robin': {
      const server = active[state.rrIndex % active.length];
      state.rrIndex++;
      return server;
    }

    case 'Least Load': {
      const safeActive = active.filter(s => !isPredictedOverload(s.id));
      const pool = safeActive.length > 0 ? safeActive : active;
      return pool.reduce((best, s) => s.cpu < best.cpu ? s : best);
    }

    case 'Weighted': {
      const totalWeight = active.reduce((sum, s) => sum + s.weight, 0);
      let rand = Math.random() * totalWeight;
      for (const s of active) {
        rand -= s.weight;
        if (rand <= 0) return s;
      }
      return active[0];
    }

    case 'Session-Aware': {
      if (userId && state.sessions[userId]) {
        const sticky = state.servers.find(
          s => s.id === state.sessions[userId] && s.status !== 'down' && !s.sleeping
        );
        if (sticky && sticky.cpu < 80) return sticky;
      }
      return active.reduce((best, s) => s.connections < best.connections ? s : best);
    }

    default:
      return active[0];
  }
}

/* ============================================================
   7. REQUEST SENDER
============================================================ */
const REQUEST_COST = {
  light:  3,
  normal: 7,
  heavy:  15,
  admin:  5,
};

function sendRequest(count = 1, userId = null) {
  for (let i = 0; i < count; i++) {
    const target = pickServer(userId);

    if (!target) {
      state.droppedReqs++;
      addLog(`❌ All servers unavailable — request dropped (${state.reqType})`, 'var(--red)');
      updateTopBar();
      continue;
    }

    const allOverloaded = state.servers
      .filter(s => !s.sleeping && s.status !== 'down')
      .every(s => s.cpu > 75);

    if (allOverloaded && state.reqType === 'normal' && Math.random() > 0.3) {
      state.droppedReqs++;
      addLog(`🛡️ Load shedding — normal request dropped (cluster overloaded)`, 'var(--orange)');
      updateTopBar();
      continue;
    }

    const cost = REQUEST_COST[state.reqType] || 7;
    const latency = Math.floor(target.cpu * 1.8 + Math.random() * 25 + cost * 4);

    target.cpu = Math.min(98, target.cpu + cost);
    target.mem = Math.min(98, target.mem + cost * 0.4);
    target.connections++;
    target.totalHandled++;
    target.lastLatency = latency;
    if (target.cpu > 85) target.status = 'overloaded';

    if (userId && !state.sessions[userId]) {
      state.sessions[userId] = target.id;
    }

    state.totalReqs++;

    const typeColors = {
      light: 'var(--green)', normal: 'var(--accent)',
      heavy: 'var(--yellow)', admin: 'var(--red)',
    };
    addLog(
      `→ [${state.reqType.toUpperCase()}] ${target.name} — CPU: ${target.cpu.toFixed(0)}% | ${latency}ms`,
      typeColors[state.reqType]
    );

    setTimeout(() => {
      target.cpu         = Math.max(3, target.cpu - cost * 0.75);
      target.connections = Math.max(0, target.connections - 1);
      if (target.cpu <= 85 && target.status !== 'down') target.status = 'healthy';
      renderServers();
      renderDistribution();
    }, 2200 + Math.random() * 800);
  }

  renderServers();
  renderDistribution();
  updateTopBar();
}

/* ============================================================
   8. SPIKE + AUTO MODE
============================================================ */
function triggerSpike() {
  addLog(`⚡ Traffic spike — 30 requests inbound`, 'var(--yellow)');
  sendRequest(30);
}

function toggleAuto() {
  state.autoMode = !state.autoMode;
  const btn = document.getElementById('autoBtn');

  if (state.autoMode) {
    state.autoInterval = setInterval(() => sendRequest(1), 700);
    btn.textContent = '■ Stop Auto';
    btn.classList.add('running');
    addLog(`● Auto stream started`, 'var(--purple)');
  } else {
    clearInterval(state.autoInterval);
    btn.textContent = '● Auto Stream';
    btn.classList.remove('running');
    addLog(`■ Auto stream stopped`, 'var(--dim)');
  }
}

/* ============================================================
   9. SERVER CONTROLS
============================================================ */
function killServer(id) {
  const s = state.servers.find(s => s.id === id);
  if (!s) return;
  s.status = 'down';
  s.connections = 0;
  addLog(`💀 ${s.name} went DOWN — traffic rerouted to healthy nodes`, 'var(--red)');
  renderServers();
  updateTopBar();
}

function reviveServer(id) {
  const s = state.servers.find(s => s.id === id);
  if (!s) return;
  s.status   = 'healthy';
  s.sleeping = false;
  s.cpu      = 8 + Math.random() * 10;
  addLog(`✅ ${s.name} revived — back online`, 'var(--green)');
  renderServers();
  updateTopBar();
}

function toggleSleep(id) {
  const s = state.servers.find(s => s.id === id);
  if (!s) return;
  s.sleeping = !s.sleeping;
  if (s.sleeping) {
    s.connections = 0;
    addLog(`💤 ${s.name} entering sleep mode (energy consolidation)`, 'var(--purple)');
  } else {
    addLog(`☀️ ${s.name} woke up — resuming traffic`, 'var(--green)');
  }
  renderServers();
}

/* ============================================================
   10. ALGORITHM + REQUEST TYPE SELECTOR
============================================================ */
function setAlgo(algoName) {
  state.algo = algoName;
  document.querySelectorAll('#algoGroup .tbtn').forEach(btn => {
    btn.classList.toggle('algo-active', btn.textContent.trim() === algoName);
  });
  updateTopBar();
  renderAlgoComparison();
  addLog(`🔄 Routing algorithm → ${algoName}`, 'var(--purple)');
}

function setReqType(type) {
  state.reqType = type;
  document.querySelectorAll('#reqGroup .tbtn').forEach(btn => {
    btn.classList.remove('req-active-light', 'req-active-normal', 'req-active-heavy', 'req-active-admin');
  });
  document.querySelectorAll('#reqGroup .tbtn').forEach(btn => {
    const labels = { light: 'Light', normal: 'Normal', heavy: 'Heavy', admin: 'Admin' };
    if (btn.textContent.trim() === labels[type]) {
      btn.classList.add(`req-active-${type}`);
    }
  });
}

/* ============================================================
   11. SESSION MANAGER
============================================================ */
function handleLogin() {
  const input = document.getElementById('loginInput');
  const user  = input.value.trim();
  if (!user) return;
  input.value = '';

  if (state.loggedUsers[user]) {
    showLoginMsg(`⚠️ Duplicate login detected for "${user}" — previous session invalidated`, 'warn');
    addLog(`🔁 Duplicate login: "${user}" — session invalidated and reissued`, 'var(--yellow)');
    delete state.sessions[user];
    state.loggedUsers[user] = Date.now();
    const target = pickServer(user);
    if (target) {
      state.sessions[user] = target.id;
      addLog(`🔐 "${user}" re-pinned to ${target.name}`, 'var(--accent)');
    }
  } else {
    state.loggedUsers[user] = Date.now();
    const target = pickServer(user);
    if (target) {
      state.sessions[user] = target.id;
      showLoginMsg(`✅ "${user}" authenticated → pinned to SRV-${String(target.id).padStart(2,'0')}`, 'ok');
      addLog(`🔐 "${user}" session started on ${target.name}`, 'var(--green)');
    } else {
      showLoginMsg(`❌ No servers available for "${user}"`, 'warn');
    }
  }

  renderSessions();
  updateTopBar();
}

function showLoginMsg(text, type) {
  const el = document.getElementById('loginMsg');
  el.textContent = text;
  el.className   = `sess-msg ${type}`;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function logoutUser(user) {
  delete state.loggedUsers[user];
  delete state.sessions[user];
  addLog(`🚪 "${user}" session terminated`, 'var(--dim)');
  renderSessions();
  updateTopBar();
}

/* ============================================================
   12. FEATURE FILTER
============================================================ */
function filterFeatures(category) {
  document.querySelectorAll('.feat-cat-btn').forEach(btn => {
    btn.classList.remove('active');
    const text = btn.textContent.toLowerCase();
    if (
      (category === 'all' && text === 'all') ||
      (category === 'core' && text === 'core') ||
      (category === 'advanced' && text === 'advanced') ||
      (category === 'unique' && text === 'unique')
    ) {
      btn.classList.add('active');
    }
  });
  document.querySelectorAll('.feat-card').forEach(card => {
    const cardCat = card.dataset.category;
    card.classList.toggle('hidden', category !== 'all' && cardCat !== category);
  });
}

/* ============================================================
   13. VIEW SWITCHING
============================================================ */
function showSimulator() {
  document.getElementById('landing').classList.add('hidden');
  document.getElementById('simulator').classList.add('active');
  renderServers();
  renderDistribution();
  renderSessions();
  renderAlgoComparison();
  updateTopBar();
  window.scrollTo(0, 0);
  addLog(`🚀 Simulator initialized. Select an algorithm and send requests.`, 'var(--accent)');
}

function showLanding() {
  if (state.autoMode) toggleAuto();
  document.getElementById('simulator').classList.remove('active');
  document.getElementById('landing').classList.remove('hidden');
  window.scrollTo(0, 0);
}

/* ============================================================
   14. RENDER FUNCTIONS
============================================================ */
function cpuColor(cpu) {
  if (cpu > 80) return 'var(--red)';
  if (cpu > 60) return 'var(--yellow)';
  return 'var(--green)';
}

function renderServers() {
  const container = document.getElementById('serverPool');
  if (!container) return;

  container.innerHTML = state.servers.map(s => {
    const statusStr   = s.sleeping ? 'SLEEP' : s.status.toUpperCase();
    const statusColor = s.sleeping ? 'var(--purple)' : (
      s.status === 'healthy'    ? 'var(--green)'  :
      s.status === 'overloaded' ? 'var(--yellow)' :
      s.status === 'down'       ? 'var(--red)'    :
      'var(--dim)'
    );
    const itemClass = `server-item ${s.sleeping ? 'sleeping' : s.status}`;
    const cpuDisplay = s.sleeping ? 0 : s.cpu;

    const killReviveBtn = s.status === 'down' || s.sleeping
      ? `<button class="sbtn sbtn-revive" onclick="reviveServer(${s.id})">Revive</button>`
      : `<button class="sbtn sbtn-kill"   onclick="killServer(${s.id})">Kill</button>`;

    const sleepBtn = s.status !== 'down'
      ? `<button class="sbtn sbtn-sleep" onclick="toggleSleep(${s.id})">${s.sleeping ? 'Wake' : 'Sleep'}</button>`
      : '';

    const predictWarning = isPredictedOverload(s.id) && !s.sleeping && s.status !== 'down'
      ? `<span style="color:var(--orange);font-family:var(--mono);font-size:9px;margin-left:4px">▲ RISING</span>`
      : '';

    return `
      <div class="${itemClass}">
        <div class="server-header">
          <div class="server-dot" style="background:${statusColor}"></div>
          <span class="server-name">${s.name}</span>
          ${predictWarning}
          <span class="server-status" style="color:${statusColor}">${statusStr}</span>
          <span class="server-lat">${s.lastLatency}ms</span>
        </div>
        <div class="metric-row">
          <span class="metric-lbl">CPU</span>
          <div class="bar-track">
            <div class="bar-fill" style="width:${cpuDisplay.toFixed(1)}%; background:${cpuColor(cpuDisplay)}"></div>
          </div>
          <span class="metric-val" style="color:${cpuColor(cpuDisplay)}">${cpuDisplay.toFixed(0)}%</span>
        </div>
        <div class="metric-row">
          <span class="metric-lbl">MEM</span>
          <div class="bar-track">
            <div class="bar-fill" style="width:${s.mem.toFixed(1)}%; background:var(--accent)"></div>
          </div>
          <span class="metric-val">${s.mem.toFixed(0)}%</span>
        </div>
        <div class="server-footer">
          <span class="server-footer-stat">CONN <b>${s.connections}</b></span>
          <span class="server-footer-stat">TOTAL <b>${s.totalHandled}</b></span>
          <span class="server-footer-stat">WT <b style="color:var(--purple)">${s.weight}</b></span>
          <div class="server-btns">
            ${killReviveBtn}
            ${sleepBtn}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderDistribution() {
  const container = document.getElementById('distChart');
  if (!container) return;

  const maxHandled = Math.max(...state.servers.map(s => s.totalHandled), 1);

  container.innerHTML = state.servers.map(s => {
    const pct   = (s.totalHandled / maxHandled) * 100;
    const color = s.status === 'down' ? 'var(--dim)' : cpuColor(s.cpu);
    return `
      <div class="dist-row">
        <span class="dist-name">${s.name}</span>
        <div class="dist-bar-wrap">
          <div class="dist-bar-fill" style="width:${pct.toFixed(1)}%; background:${color}">
            <span class="dist-bar-text">${s.totalHandled > 3 ? s.totalHandled : ''}</span>
          </div>
        </div>
        <span class="dist-count">${s.totalHandled} req</span>
      </div>
    `;
  }).join('');
}

function renderSessions() {
  const container = document.getElementById('sessionTags');
  if (!container) return;

  const users = Object.keys(state.loggedUsers);
  if (!users.length) {
    container.innerHTML = `<span style="font-family:var(--mono);font-size:11px;color:var(--dim)">No active sessions.</span>`;
    return;
  }

  container.innerHTML = users.map(user => {
    const serverId = state.sessions[user];
    const srvName  = serverId ? `SRV-${String(serverId).padStart(2,'0')}` : '??';
    return `
      <div class="sess-tag">
        <div class="sess-dot"></div>
        <span>${user}</span>
        <span class="sess-server">→ ${srvName}</span>
        <button class="sess-close" onclick="logoutUser('${user}')" title="Logout">✕</button>
      </div>
    `;
  }).join('');
}

function renderAlgoComparison() {
  const container = document.getElementById('algoCompare');
  if (!container) return;

  const algos = [
    { name: 'Round Robin',   score: 60, color: 'var(--accent)', desc: 'Equal distribution, ignores real load' },
    { name: 'Least Load',    score: 85, color: 'var(--green)',  desc: 'Routes to lowest CPU — best balance' },
    { name: 'Weighted',      score: 75, color: 'var(--yellow)', desc: 'Proportional to server capacity weight' },
    { name: 'Session-Aware', score: 92, color: 'var(--purple)', desc: 'Sticky sessions + adaptive fallback' },
  ];

  const active = algos.find(a => a.name === state.algo);
  const descHtml = active
    ? `<div class="cmp-desc">▶ <b>${active.name}</b>: ${active.desc}</div>`
    : '';

  container.innerHTML = descHtml + algos.map(a => {
    const isActive = a.name === state.algo;
    return `
      <div class="cmp-row">
        <span class="cmp-name ${isActive ? 'active-algo' : ''}">${isActive ? '▶ ' : ''}${a.name}</span>
        <div class="cmp-bar-wrap">
          <div class="cmp-bar" style="width:${a.score}%; background:${isActive ? a.color : 'var(--dim)'}"></div>
        </div>
        <span class="cmp-score">${a.score}/100</span>
      </div>
    `;
  }).join('');
}

function updateTopBar() {
  const activeCpus = state.servers
    .filter(s => s.status !== 'down' && !s.sleeping)
    .map(s => s.cpu);

  let variance = 0;
  if (activeCpus.length > 1) {
    const mean = activeCpus.reduce((a, b) => a + b, 0) / activeCpus.length;
    variance = Math.sqrt(activeCpus.reduce((a, b) => a + (b - mean) ** 2, 0) / activeCpus.length);
  }

  const el = id => document.getElementById(id);
  if (el('statTotal'))    el('statTotal').textContent    = state.totalReqs;
  if (el('statDropped'))  el('statDropped').textContent  = state.droppedReqs;
  if (el('statSessions')) el('statSessions').textContent = Object.keys(state.loggedUsers).length;
  if (el('statVariance')) el('statVariance').textContent = `${variance.toFixed(1)}%`;
  if (el('statAlgo'))     el('statAlgo').textContent     = state.algo;
}

/* ============================================================
   15. EVENT LOG
============================================================ */
function addLog(message, color = 'var(--text)') {
  const container = document.getElementById('eventLog');
  if (!container) return;

  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-msg" style="color:${color}">${message}</span>
  `;

  container.insertBefore(entry, container.firstChild);

  while (container.children.length > 60) {
    container.removeChild(container.lastChild);
  }
}

/* ============================================================
   16. INIT
============================================================ */
boot();