# 🎮 OPERATION FRONTIER — Battle Royale

A full browser-based 3D Battle Royale game. Free to host. No Unity, no Unreal, no fees.

---

## ⚡ PLAY INSTANTLY (Local)

### Step 1 — Start the server
```bash
cd server
npm install
node index.js
```
Server starts at `http://localhost:3001`

### Step 2 — Open the game
Just open `client/index.html` in your browser.
> No build step. No webpack. Just open the file.

---

## 🌐 DEPLOY FREE (Online Multiplayer)

### Backend → Render.com (Free)
1. Push this repo to GitHub
2. Go to https://render.com → New Web Service
3. Connect your GitHub repo
4. Settings:
   - **Build Command:** `cd server && npm install`
   - **Start Command:** `cd server && node index.js`
   - **Plan:** Free
5. Copy the URL Render gives you (e.g. `https://operation-frontier-server.onrender.com`)

### Frontend → Vercel (Free)
1. Go to https://vercel.com → New Project
2. Connect your GitHub repo
3. Set **Root Directory** to `client`
4. Deploy → done

### Connect them
In `client/index.html`, find this line (around line 20):
```js
const SERVER_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3001'
  : 'https://operation-frontier-server.onrender.com'; // ← CHANGE THIS
```
Replace with your Render URL.

---

## 🎮 CONTROLS

| Key | Action |
|-----|--------|
| `WASD` | Move |
| `Mouse` | Aim / Look |
| `Left Click` | Shoot |
| `Right Click` | Sniper Scope (when holding Sniper) |
| `F` | Pick up loot / Enter vehicle |
| `E` | Exit vehicle |
| `Space` | Speed up parachute descent |

---

## 🗺️ WHAT'S IN THE GAME

### Gameplay
- ✅ 100-player matches (filled with bots offline)
- ✅ Parachute drop from 400m altitude
- ✅ Shrinking blue zone (damages you outside)
- ✅ Kill feed, hit markers, damage flash
- ✅ Win condition — last one standing

### Weapons (5 types)
- **AR** — Assault Rifle (30 dmg, fast fire)
- **Sniper** — 80 dmg, scope with RMB, slow fire
- **SMG** — 20 dmg, fastest fire rate
- **Shotgun** — 60 dmg, close range
- **Pistol** — 25 dmg, starter weapon

### Items
- **Heal** — Restores 30 HP
- **Armor** — Adds 50 armor (absorbs 50% damage)
- **Ammo** — +30 rounds

### Vehicles (3 types)
- **Car** — Fast, 4 wheels, road-ready
- **Motorcycle** — Fastest, agile
- **Boat** — Water traversal

### AI Bots (20 per match)
- Loot intelligently
- Chase and shoot players on sight
- Take cover and flank
- Drive vehicles
- Drop loot on death

### Map (2000×2000)
- Cities with buildings
- Dense forest with 400 trees
- Rivers and lake
- Roads (horizontal + vertical grid)
- Rocky terrain cover
- Military-style border walls

---

## 🏗️ TECH STACK (All Free)

| Layer | Tech | Cost |
|-------|------|------|
| 3D Engine | Three.js r128 (CDN) | Free |
| Multiplayer | Socket.io | Free |
| Server | Node.js + Express | Free |
| Frontend hosting | Vercel | Free |
| Backend hosting | Render.com | Free |
| Database | None needed (in-memory) | Free |

---

## 📁 FILE STRUCTURE

```
operation-frontier/
├── client/
│   └── index.html       ← Entire game frontend (3D + HUD + UI)
├── server/
│   ├── index.js         ← Game server (matchmaking, game loop, AI)
│   └── package.json
├── render.yaml          ← Render.com deploy config
├── vercel.json          ← Vercel deploy config
└── README.md
```

---

## 🔧 KNOWN LIMITS (Free Tier)

| Issue | Cause | Fix |
|-------|-------|-----|
| Server sleeps after 15min inactivity | Render free tier | Upgrade to $7/mo or use UptimeRobot to ping it |
| Max ~50 concurrent players | Free server RAM | Upgrade Render plan |
| Graphics are low-poly | Browser / Three.js | Cannot match UE5 in browser |
| No voice chat | TURN server costs money | Use Discord in a separate window |

---

## 🔮 FUTURE FEATURES (can be added)

- [ ] MongoDB for player stats / leaderboard
- [ ] JWT login + accounts
- [ ] Squad mode (4-player teams)
- [ ] More weapons (RPG, grenades)
- [ ] Day/night cycle
- [ ] Dynamic weather (fog, rain)
- [ ] Mobile touch controls
- [ ] Spectator mode after death
- [ ] Seasonal battle pass UI
