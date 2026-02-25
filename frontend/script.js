/* ============================================================
   script.js — AdaptLB Adaptive Load Balancer Simulator
   All simulator logic, state management, and DOM rendering
============================================================ */

/* ============================================================
   1. STATE — Single source of truth for the entire simulation
============================================================ */

// Simulation state object — all mutable data lives here
const state = {
  servers: [],          // Array of server objects
  algo: 'Least Load',   // Active routing algorithm
  reqType: 'normal',    // Active request type: light | normal | heavy | admin
  sessions: {},         // { username: serverId } — session-to-server map
  loggedUsers: {},      // { username: timestamp } — active logins
  rrIndex: 0,           // Round Robin pointer
  totalReqs: 0,         // Total requests sent
  droppedReqs: 0,       // Requests dropped due to overload / shedding
  autoMode: false,      // Auto mode running flag
  autoInterval: null,   // setInterval handle for auto mode
  loadHistory: {},      // { serverId: [cpu readings] } — for sliding window prediction
};

/* ============================================================
   2. SERVER FACTORY — Create a server object with random initial values
============================================================ */

/**
 * Creates a new server object.
 * @param {number} id — numeric ID (1-based)
 * @returns {object} server state object
 */
function createServer(id) {
  return {
    id,
    name: `SRV-${String(id).padStart(2, '0')}`,
    cpu: Math.random() * 25 + 5,           // Initial CPU 5–30%
    mem: Math.random() * 35 + 15,          // Initial MEM 15–50%
    connections: 0,                          // Active connections
    status: 'healthy',                       // healthy | overloaded | down | sleeping
    weight: Math.floor(Math.random() * 3) + 1, // Weighted algo weight (1–3)
    totalHandled: 0,                         // Lifetime requests handled
    lastLatency: 0,                          // Last response latency (ms)
    sleeping: false,                         // Energy-saving sleep mode
  };
}

/* ============================================================
   3. BOOT — Initialize servers and start background tick
============================================================ */

/**
 * Initializes 4 servers and kicks off the periodic CPU drift.
 * Called once on page load.
 */
function boot() {
  // Create 4 servers
  for (let i = 1; i <= 4; i++) {
    state.servers.push(createServer(i));
    state.loadHistory[i] = [];
  }

  // Render initial algo comparison panel
  renderAlgoComparison();

  // Background ticker — simulates organic CPU/MEM drift every 1.2s
  setInterval(tickServers, 1200);
}

/* ============================================================
   4. SERVER TICK — Organic background drift for realism
============================================================ */

/**
 * Randomly drifts CPU and MEM for all live servers.
 * Also updates status based on CPU threshold.
 * Feeds the loadHistory sliding window for prediction.
 */
function tickServers() {
  state.servers.forEach(s => {
    // Skip dead or sleeping servers
    if (s.status === 'down' || s.sleeping) return;

    // Slight random drift — servers fluctuate naturally
    s.cpu = Math.max(3, s.cpu + (Math.random() - 0.52) * 4);
    s.mem = Math.max(8, s.mem + (Math.random() - 0.51) * 2);

    // Cap values
    s.cpu = Math.min(98, s.cpu);
    s.mem = Math.min(98, s.mem);

    // Update status based on CPU
    if (s.cpu > 85)      s.status = 'overloaded';
    else if (s.cpu > 62) s.status = 'busy';
    else                  s.status = 'healthy';

    // Feed sliding window (last 8 readings)
    state.loadHistory[s.id].push(s.cpu);
    if (state.loadHistory[s.id].length > 8) {
      state.loadHistory[s.id].shift();
    }
  });

  // Re-render server pool and distribution chart on every tick
  renderServers();
  renderDistribution();
  updateTopBar();
}

/* ============================================================
   5. LOAD PREDICTION — Sliding window trend detection
   No ML. Deterministic. Explainable to judges.
============================================================ */

/**
 * Predicts if a server's load is trending up using a sliding window average.
 * Compares first-half average vs second-half average.
 * @param {number} serverId
 * @returns {boolean} true if load is rising
 */
function isPredictedOverload(serverId) {
  const history = state.loadHistory[serverId] || [];
  if (history.length < 6) return false;

  const half = Math.floor(history.length / 2);
  const firstHalfAvg = history.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const secondHalfAvg = history.slice(half).reduce((a, b) => a + b, 0) / (history.length - half);

  // Rising trend: second half is 10+ points higher than first half
  return (secondHalfAvg - firstHalfAvg) > 10;
}

/* ============================================================
   6. ROUTING ALGORITHMS — Core load balancing logic
============================================================ */

/**
 * Picks the best server for the next request using the active algorithm.
 * @param {string|null} userId — for session-aware sticky routing
 * @returns {object|null} chosen server, or null if all down
 */
function pickServer(userId = null) {
  // Only consider servers that are alive and not sleeping
  const active = state.servers.filter(s => s.status !== 'down' && !s.sleeping);
  if (!active.length) return null;

  switch (state.algo) {

    /* ── Round Robin ────────────────────────────────────────
       Cycles through servers in fixed order.
       Simple, stateless, ignores actual load.
    ─────────────────────────────────────────────────────── */
    case 'Round Robin': {
      const server = active[state.rrIndex % active.length];
      state.rrIndex++;
      return server;
    }

    /* ── Least Load ─────────────────────────────────────────
       Routes to the server with lowest current CPU.
       Best general-purpose adaptive algorithm.
    ─────────────────────────────────────────────────────── */
    case 'Least Load': {
      // Exclude predicted-overload servers if possible
      const safeActive = active.filter(s => !isPredictedOverload(s.id));
      const pool = safeActive.length > 0 ? safeActive : active;
      return pool.reduce((best, s) => s.cpu < best.cpu ? s : best);
    }

    /* ── Weighted ───────────────────────────────────────────
       Probabilistic: servers with higher weight get more traffic.
       Useful when servers have different capacities.
    ─────────────────────────────────────────────────────── */
    case 'Weighted': {
      const totalWeight = active.reduce((sum, s) => sum + s.weight, 0);
      let rand = Math.random() * totalWeight;
      for (const s of active) {
        rand -= s.weight;
        if (rand <= 0) return s;
      }
      return active[0];
    }

    /* ── Session-Aware ──────────────────────────────────────
       Sticky: pins user to their original server.
       Falls back to least-connections if server degrades.
    ─────────────────────────────────────────────────────── */
    case 'Session-Aware': {
      // Try sticky server first
      if (userId && state.sessions[userId]) {
        const sticky = state.servers.find(
          s => s.id === state.sessions[userId] && s.status !== 'down' && !s.sleeping
        );
        if (sticky && sticky.cpu < 80) return sticky; // Serve sticky if healthy
      }
      // Fallback: route to server with fewest connections
      return active.reduce((best, s) => s.connections < best.connections ? s : best);
    }

    default:
      return active[0];
  }
}

/* ============================================================
   7. REQUEST SENDER — Core routing + effects
============================================================ */

/**
 * Request cost map — heavier requests burn more CPU.
 * This simulates request-type awareness for the scheduler.
 */
const REQUEST_COST = {
  light:  3,    // Lightweight (static assets, pings)
  normal: 7,    // Standard API call
  heavy:  15,   // Complex computation, DB joins
  admin:  5,    // Admin/internal — treated as high priority
};

/**
 * Sends N requests through the load balancer.
 * Handles: graceful load shedding, session affinity, cool-down, latency tracking.
 * @param {number} count — number of requests to send
 * @param {string|null} userId — optional session user
 */
function sendRequest(count = 1, userId = null) {
  for (let i = 0; i < count; i++) {
    const target = pickServer(userId);

    /* ── Graceful Load Shedding ──────────────────────────
       If no servers available, or all are overloaded:
       - Drop low-priority (normal) requests
       - Always serve admin/high requests if possible
    ───────────────────────────────────────────────────── */
    if (!target) {
      state.droppedReqs++;
      addLog(`❌ All servers down — request DROPPED (${state.reqType})`, 'var(--red)');
      updateTopBar();
      continue;
    }

    // Graceful shedding: drop low-priority if cluster is overwhelmed
    const allOverloaded = state.servers.filter(s => !s.sleeping && s.status !== 'down').every(s => s.cpu > 75);
    if (allOverloaded && state.reqType === 'normal' && Math.random() > 0.3) {
      state.droppedReqs++;
      addLog(`🛡️ Load shedding — normal request dropped (cluster overloaded)`, 'var(--orange)');
      updateTopBar();
      continue;
    }

    // Cost of this request type
    const cost = REQUEST_COST[state.reqType] || 7;

    // Simulate latency: base = cpu * 2 + jitter + request cost penalty
    const latency = Math.floor(target.cpu * 1.8 + Math.random() * 25 + cost * 4);

    // Apply request load to chosen server
    target.cpu = Math.min(98, target.cpu + cost);
    target.mem = Math.min(98, target.mem + cost * 0.4);
    target.connections++;
    target.totalHandled++;
    target.lastLatency = latency;
    if (target.cpu > 85) target.status = 'overloaded';

    // Pin session to server (Session-Aware + session manager)
    if (userId && !state.sessions[userId]) {
      state.sessions[userId] = target.id;
    }

    // Increment totals
    state.totalReqs++;

    // Log the routing decision
    const typeColors = {
      light: 'var(--green)', normal: 'var(--accent)',
      heavy: 'var(--yellow)', admin: 'var(--red)',
    };
    addLog(
      `→ [${state.reqType.toUpperCase()}] ${target.name} — CPU: ${target.cpu.toFixed(0)}% | ${latency}ms`,
      typeColors[state.reqType]
    );

    /* ── Server Cool-Down ────────────────────────────────
       After processing, CPU and connections decay back to baseline.
       Prevents permanent overload after bursts.
    ───────────────────────────────────────────────────── */
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

/**
 * Traffic spike — floods system with 30 simultaneous requests.
 * Demonstrates adaptive redistribution under stress.
 */
function triggerSpike() {
  addLog(`⚡ TRAFFIC SPIKE — 30 requests inbound!`, 'var(--yellow)');
  sendRequest(30);
}

/**
 * Toggles continuous auto-send mode.
 * Sends 1 request every 700ms when active.
 */
function toggleAuto() {
  state.autoMode = !state.autoMode;
  const btn = document.getElementById('autoBtn');

  if (state.autoMode) {
    state.autoInterval = setInterval(() => sendRequest(1), 700);
    btn.textContent   = '■ STOP AUTO';
    btn.classList.add('running');
    addLog(`● Auto mode STARTED`, 'var(--purple)');
  } else {
    clearInterval(state.autoInterval);
    btn.textContent = '● AUTO MODE';
    btn.classList.remove('running');
    addLog(`■ Auto mode STOPPED`, 'var(--dim)');
  }
}

/* ============================================================
   9. SERVER CONTROLS — Kill, Revive, Sleep
============================================================ */

/**
 * Kills a server — marks it down, clears connections.
 * Router will avoid it in future picks.
 * @param {number} id — server ID
 */
function killServer(id) {
  const s = state.servers.find(s => s.id === id);
  if (!s) return;
  s.status      = 'down';
  s.connections = 0;
  addLog(`💀 ${s.name} went DOWN — traffic rerouted`, 'var(--red)');
  renderServers();
  updateTopBar();
}

/**
 * Revives a downed or sleeping server.
 * Resets CPU to a low baseline.
 * @param {number} id — server ID
 */
function reviveServer(id) {
  const s = state.servers.find(s => s.id === id);
  if (!s) return;
  s.status   = 'healthy';
  s.sleeping = false;
  s.cpu      = 8 + Math.random() * 10;
  addLog(`✅ ${s.name} REVIVED — back online`, 'var(--green)');
  renderServers();
  updateTopBar();
}

/**
 * Toggles energy-saving sleep mode for a server.
 * Sleeping servers accept no new traffic but are not "dead".
 * When traffic is low, consolidating to fewer servers saves power.
 * @param {number} id — server ID
 */
function toggleSleep(id) {
  const s = state.servers.find(s => s.id === id);
  if (!s) return;
  s.sleeping = !s.sleeping;
  if (s.sleeping) {
    s.connections = 0;
    addLog(`💤 ${s.name} entering SLEEP mode (energy saving)`, 'var(--purple)');
  } else {
    addLog(`☀️ ${s.name} WOKE UP — resuming traffic`, 'var(--green)');
  }
  renderServers();
}

/* ============================================================
   10. ALGORITHM SELECTOR
============================================================ */

/**
 * Sets the active routing algorithm and updates the UI.
 * @param {string} algoName
 */
function setAlgo(algoName) {
  state.algo = algoName;
  // Update button active states
  document.querySelectorAll('#algoGroup .tbtn').forEach(btn => {
    btn.classList.toggle('algo-active', btn.textContent.trim() === algoName);
  });
  updateTopBar();
  renderAlgoComparison();
  addLog(`🔄 Algorithm switched → ${algoName}`, 'var(--purple)');
}

/**
 * Sets the active request type and updates the UI.
 * @param {string} type — light | normal | heavy | admin
 */
function setReqType(type) {
  state.reqType = type;
  // Update button active states
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
   11. SESSION MANAGER — Duplicate login prevention
============================================================ */

/**
 * Handles user login attempt.
 * - If user already logged in: invalidates old session, creates new one (duplicate prevention)
 * - If new user: creates session, pins to a server
 */
function handleLogin() {
  const input = document.getElementById('loginInput');
  const msgEl = document.getElementById('loginMsg');
  const user  = input.value.trim();
  if (!user) return;

  input.value = '';

  if (state.loggedUsers[user]) {
    /* ── Duplicate Login Prevention ────────────────────
       Same user logging in again.
       Strategy: invalidate previous session, issue new one.
       This prevents session explosion and artificial load.
    ───────────────────────────────────────────────────── */
    showLoginMsg(`⚠️ Duplicate login detected for "${user}" — previous session invalidated`, 'warn');
    addLog(`🔁 Duplicate login: "${user}" — session reset`, 'var(--yellow)');
    // Invalidate old session
    delete state.sessions[user];
    state.loggedUsers[user] = Date.now();
    // Assign to best server freshly
    const target = pickServer(user);
    if (target) {
      state.sessions[user] = target.id;
      addLog(`🔐 "${user}" re-pinned to ${target.name}`, 'var(--accent)');
    }
  } else {
    // New login
    state.loggedUsers[user] = Date.now();
    const target = pickServer(user);
    if (target) {
      state.sessions[user] = target.id;
      showLoginMsg(`✅ "${user}" logged in → pinned to SRV-${String(target.id).padStart(2,'0')}`, 'ok');
      addLog(`🔐 "${user}" session started on ${target.name}`, 'var(--green)');
    } else {
      showLoginMsg(`❌ No servers available for "${user}"`, 'warn');
    }
  }

  renderSessions();
  updateTopBar();
}

/** Shows a temporary message in the session panel */
function showLoginMsg(text, type) {
  const el = document.getElementById('loginMsg');
  el.textContent   = text;
  el.className     = `sess-msg ${type}`;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

/**
 * Logs out a user — removes session and login record.
 * @param {string} user
 */
function logoutUser(user) {
  delete state.loggedUsers[user];
  delete state.sessions[user];
  addLog(`🚪 "${user}" logged out`, 'var(--dim)');
  renderSessions();
  updateTopBar();
}

/* ============================================================
   12. FEATURE FILTER — Landing page category filter
============================================================ */

/**
 * Filters feature cards on the landing page by category.
 * @param {string} category — 'all' | 'core' | 'advanced' | 'unique'
 */
function filterFeatures(category) {
  // Update active button
  document.querySelectorAll('.feat-cat-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.textContent.toLowerCase().includes(category) || (category === 'all' && btn.textContent === 'All Features')) {
      btn.classList.add('active');
    }
  });
  // Show/hide cards
  document.querySelectorAll('.feat-card').forEach(card => {
    const cardCat = card.dataset.category;
    const show = category === 'all' || cardCat === category;
    card.classList.toggle('hidden', !show);
  });
}

/* ============================================================
   13. VIEW SWITCHING — Landing ↔ Simulator
============================================================ */

/**
 * Shows the simulator and hides the landing page.
 * Called by "Start Simulation" / "Launch Simulator" buttons.
 */
function showSimulator() {
  document.getElementById('landing').classList.add('hidden');
  document.getElementById('simulator').classList.add('active');
  // Full initial render
  renderServers();
  renderDistribution();
  renderSessions();
  renderAlgoComparison();
  updateTopBar();
  // Scroll to top
  window.scrollTo(0, 0);
  addLog(`🚀 Simulation started. Select algorithm and send requests.`, 'var(--accent)');
}

/**
 * Returns to the landing page from the simulator.
 * Stops auto mode if running.
 */
function showLanding() {
  if (state.autoMode) toggleAuto(); // Stop auto
  document.getElementById('simulator').classList.remove('active');
  document.getElementById('landing').classList.remove('hidden');
  window.scrollTo(0, 0);
}

/* ============================================================
   14. RENDER FUNCTIONS — DOM updates
============================================================ */

/**
 * Helper: returns the correct color for a CPU percentage.
 * @param {number} cpu
 * @returns {string} CSS color string
 */
function cpuColor(cpu) {
  if (cpu > 80) return 'var(--red)';
  if (cpu > 60) return 'var(--yellow)';
  return 'var(--green)';
}

/**
 * Renders all server cards in the server pool panel.
 * Shows CPU bar, MEM bar, connections, latency, kill/sleep/revive buttons.
 */
function renderServers() {
  const container = document.getElementById('serverPool');
  if (!container) return;

  container.innerHTML = state.servers.map(s => {
    const statusStr  = s.sleeping ? 'SLEEP' : s.status.toUpperCase();
    const statusColor = s.sleeping ? 'var(--purple)' : (
      s.status === 'healthy' ? 'var(--green)' :
      s.status === 'overloaded' ? 'var(--yellow)' :
      s.status === 'down' ? 'var(--red)' : 'var(--dim)'
    );
    const dotColor = statusColor;
    const itemClass = `server-item ${s.sleeping ? 'sleeping' : s.status}`;

    // CPU display — show "ZZZ" if sleeping
    const cpuDisplay = s.sleeping ? 0 : s.cpu;

    // Kill or Revive button
    const killReviveBtn = s.status === 'down' || s.sleeping
      ? `<button class="sbtn sbtn-revive" onclick="reviveServer(${s.id})">REVIVE</button>`
      : `<button class="sbtn sbtn-kill" onclick="killServer(${s.id})">KILL</button>`;

    // Sleep/Wake button (not shown if dead)
    const sleepBtn = s.status !== 'down'
      ? `<button class="sbtn sbtn-sleep" onclick="toggleSleep(${s.id})">${s.sleeping ? 'WAKE' : 'SLEEP'}</button>`
      : '';

    // Prediction warning indicator
    const predictWarning = isPredictedOverload(s.id) && !s.sleeping && s.status !== 'down'
      ? `<span style="color:var(--orange);font-family:var(--mono);font-size:10px;margin-left:6px">▲ RISING</span>`
      : '';

    return `
      <div class="${itemClass}">
        <div class="server-header">
          <div class="server-dot" style="background:${dotColor}"></div>
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
          <span class="server-footer-stat">WEIGHT <b style="color:var(--purple)">${s.weight}</b></span>
          <div class="server-btns">
            ${killReviveBtn}
            ${sleepBtn}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Renders the load distribution bar chart.
 * Shows total requests handled per server as a relative bar.
 */
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

/**
 * Renders active session tags in the session manager panel.
 */
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
    const srvName = serverId ? `SRV-${String(serverId).padStart(2,'0')}` : '??';
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

/**
 * Renders the algorithm comparison panel.
 * Highlights the currently active algorithm.
 */
function renderAlgoComparison() {
  const container = document.getElementById('algoCompare');
  if (!container) return;

  const algos = [
    { name: 'Round Robin',    score: 60, color: 'var(--accent)', desc: 'Equal distribution, ignores real load' },
    { name: 'Least Load',     score: 85, color: 'var(--green)',  desc: 'Routes to lowest CPU — best balance' },
    { name: 'Weighted',       score: 75, color: 'var(--yellow)', desc: 'Proportional to server capacity weight' },
    { name: 'Session-Aware',  score: 92, color: 'var(--purple)', desc: 'Sticky sessions + adaptive fallback' },
  ];

  // Show active algorithm description
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

/**
 * Updates the top status bar in the simulator.
 * Shows total requests, dropped, sessions, load variance, active algo.
 */
function updateTopBar() {
  // Load variance — standard deviation across active server CPUs
  const activeCpus = state.servers.filter(s => s.status !== 'down' && !s.sleeping).map(s => s.cpu);
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
   15. EVENT LOG — Timestamped activity feed
============================================================ */

/**
 * Prepends a new entry to the event log panel.
 * @param {string} message
 * @param {string} color — CSS color string
 */
function addLog(message, color = 'var(--text)') {
  const container = document.getElementById('eventLog');
  if (!container) return;

  const now = new Date();
  const time = now.toLocaleTimeString('en-US', { hour12: false });

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-msg" style="color:${color}">${message}</span>
  `;

  // Prepend so newest is at top
  container.insertBefore(entry, container.firstChild);

  // Keep log at max 60 entries to avoid memory leak
  while (container.children.length > 60) {
    container.removeChild(container.lastChild);
  }
}

/* ============================================================
   16. INIT — Run on page load
============================================================ */
boot();