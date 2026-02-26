# ◈ AdaptLB — Adaptive Load Balancer Simulator

> A browser-based simulator for engineers who want to understand how adaptive routing algorithms behave under real traffic conditions — spike handling, session affinity, fault tolerance, and energy-aware scheduling.

![Vanilla JS](https://img.shields.io/badge/Vanilla-JS-ffc900?style=flat-square&labelColor=070e1a)
![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-00e896?style=flat-square&labelColor=070e1a)
![Browser](https://img.shields.io/badge/Runs%20In-Browser-00c8f0?style=flat-square&labelColor=070e1a)
![License](https://img.shields.io/badge/License-MIT-a855f7?style=flat-square&labelColor=070e1a)

---

## What Is This?

AdaptLB simulates how a production load balancer decides where to route incoming requests. It models four routing algorithms, session stickiness, fault tolerance, predictive overload detection, and energy-aware server consolidation — all running live in a single browser tab with no backend required.

Built for DevOps engineers, backend developers, CS students, and anyone preparing for system design interviews who wants to see these concepts in action rather than just read about them.

---

## Quick Start

```bash
git clone https://github.com/your-username/adaptlb.git
cd adaptlb
open index.html   # or just double-click it
```

No build step. No `npm install`. No server required.

---

## Project Structure

```
adaptlb/
├── index.html     # Landing page + simulator layout
├── style.css      # All styling, animations, responsive layout
└── script.js      # All simulator logic, routing algorithms, state management
```

---

## Features

### Core

| Feature | Description |
|---|---|
| **Server Pool Simulation** | 4 backend servers with live CPU %, MEM %, active connections, and health status |
| **Request Generation** | Single · Burst ×10 · Spike ×30 · Auto-stream mode |
| **Adaptive Load Distribution** | Requests routed dynamically based on real-time server state |
| **Real-Time Dashboard** | Live CPU bars, request counters, routing log, distribution chart |
| **Failure Simulation** | Kill any server instantly — traffic reroutes to healthy nodes automatically |

### Advanced

| Feature | Description |
|---|---|
| **Load Spike Handling** | Fire 30 concurrent requests and observe adaptive redistribution |
| **Server Cool-Down** | Overloaded servers pause intake and recover — prevents cascading failures |
| **Request Type Awareness** | Light / Normal / Heavy / Admin — each carries a different CPU cost |
| **Latency-Based Feedback** | Response time tracked per server; slow servers are penalized in routing |

### Unique

| Feature | Description |
|---|---|
| **Session-Aware Balancing** | Sticky session affinity with intelligent fallback when the pinned server degrades |
| **Duplicate Login Prevention** | One active session per user — second login invalidates the first automatically |
| **Load Prediction (Sliding Window)** | Detects rising CPU trends across the last 8 readings; preemptively avoids affected servers |
| **Graceful Load Shedding** | Drops low-priority requests under full cluster load; admin requests always pass |
| **Energy-Aware Sleep Mode** | Consolidate traffic and idle underutilized servers — models cloud autoscaling behavior |
| **Algorithm Comparison Mode** | Live scoring panel comparing all four algorithms side by side |

---

## Routing Algorithms

```
01  Round Robin      Score: 60/100   Stateless · O(1) · Ignores real load
02  Least Load       Score: 85/100   Adaptive · CPU-aware · Best general-purpose
03  Weighted         Score: 75/100   Capacity-aware · Probabilistic · Configurable
04  Session-Aware    Score: 92/100   Sticky sessions · Adaptive fallback · Stateful
```

All four algorithms can be switched live without resetting the simulation.

---

## How a Request Is Processed

```
Request arrives
    │
    ▼
Carry type (light / normal / heavy / admin) + optional session ID
    │
    ▼
Active algorithm evaluates healthy, non-sleeping servers
    │
    ▼
Target selected → CPU rises by request cost · Latency computed
    │
    ▼
After 2–3s: CPU decays · Connections release · Status updates
```

---

## Key Implementation Details

### Sliding Window Load Prediction

```js
// Compares first-half vs second-half average of last 8 CPU readings.
// No ML — fully deterministic and explainable.
// Rising trend > 10 points triggers early avoidance.
function isPredictedOverload(serverId) {
  const history = state.loadHistory[serverId];
  if (history.length < 6) return false;

  const half       = Math.floor(history.length / 2);
  const firstAvg   = avg(history.slice(0, half));
  const secondAvg  = avg(history.slice(half));

  return (secondAvg - firstAvg) > 10;
}
```

### Graceful Load Shedding

```js
// When ALL active servers exceed 75% CPU:
// - Normal requests are dropped with 70% probability
// - Admin and heavy requests always pass through
const allOverloaded = state.servers
  .filter(s => !s.sleeping && s.status !== 'down')
  .every(s => s.cpu > 75);

if (allOverloaded && reqType === 'normal') { /* drop */ }
```

### Duplicate Login Prevention

```js
// Second login for the same user:
// 1. Deletes existing session and server affinity
// 2. Issues a fresh session pinned to the current optimal server
if (state.loggedUsers[user]) {
  delete state.sessions[user];
  state.loggedUsers[user] = Date.now();
  // re-pin to best available server
}
```

### Server Cool-Down

```js
// After request completes (2.2–3s simulated delay):
// CPU decays by 75% of the request cost
// Prevents permanent overload from sustained burst traffic
setTimeout(() => {
  target.cpu = Math.max(3, target.cpu - cost * 0.75);
}, 2200 + Math.random() * 800);
```

---

## `script.js` — Module Map

| Section | Function(s) | Purpose |
|---|---|---|
| 1 | `state` | Single source of truth for all simulation data |
| 2 | `createServer()` | Builds a server object with randomized initial values |
| 3 | `boot()` | Initializes 4 servers and starts the background tick |
| 4 | `tickServers()` | Organic CPU/MEM drift every 1.2s |
| 5 | `isPredictedOverload()` | Sliding window trend detection |
| 6 | `pickServer()` | All four routing algorithms |
| 7 | `sendRequest()` | Core routing + shedding + cool-down + latency |
| 8 | `triggerSpike()` / `toggleAuto()` | Spike and auto-stream modes |
| 9 | `killServer()` / `reviveServer()` / `toggleSleep()` | Server state controls |
| 10 | `setAlgo()` / `setReqType()` | Algorithm and request type selectors |
| 11 | `handleLogin()` / `logoutUser()` | Session manager and duplicate login prevention |
| 12 | `filterFeatures()` | Landing page category filter |
| 13 | `showSimulator()` / `showLanding()` | View switching |
| 14 | `renderServers()` / `renderDistribution()` / etc. | DOM render functions |
| 15 | `addLog()` | Timestamped event log |
| 16 | `boot()` | Entry point, called on page load |

---

## Browser Support

Works in all modern browsers. No polyfills needed.

| Chrome | Firefox | Safari | Edge |
|:------:|:-------:|:------:|:----:|
| ✓ | ✓ | ✓ | ✓ |

---

## Use Cases

- **DevOps / SRE** — Model routing behavior before pushing infrastructure changes
- **CS Students** — Visualize distributed systems concepts interactively
- **System Design Prep** — Explore algorithm tradeoffs hands-on
- **Backend Engineers** — Prototype and validate load balancing strategies

---

## License

MIT — free to use, modify, and distribute.
