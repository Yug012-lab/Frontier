const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ─── Game Constants ───────────────────────────────────────────────────────────
const MAP_SIZE = 2500;
const ZONE_SHRINK_INTERVAL = 3600000; // 
const LOOT_COUNT = 300;
const BOT_COUNT = 20;
const TICK_RATE = 64; // ms
const PLAYER_SPEED = 100;
const BOT_SPEED = 4;
const BULLET_SPEED = 60;
const BULLET_DAMAGE = { AR: 30, Sniper: 80, SMG: 20, Shotgun: 60, Pistol: 25 };
const HEAL_AMOUNT = 30;
const VEHICLE_SPEED = 16;

// ─── Game State ───────────────────────────────────────────────────────────────
const rooms = {}; // roomId -> GameRoom

class GameRoom {
  constructor(id) {
    this.id = id;
    this.players = {};
    this.bots = {};
    this.bullets = {};
    this.loot = {};
    this.vehicles = {};
    this.zone = { x: MAP_SIZE / 2, z: MAP_SIZE / 2, radius: MAP_SIZE / 2, targetRadius: MAP_SIZE / 2 };
    this.phase = 'waiting'; // waiting, active, ended
    this.tick = 0;
    this.zonePhase = 0;
    this.killFeed = [];
    this.startTime = null;
    this.interval = null;
    this.zoneInterval = null;
    this.generateLoot();
    this.generateVehicles();
    this.spawnBots();
  }

  generateLoot() {
    const weapons = ['AR', 'Sniper', 'SMG', 'Shotgun', 'Pistol'];
    const items = ['Heal', 'Armor', 'Ammo'];
    for (let i = 0; i < LOOT_COUNT; i++) {
      const id = uuidv4();
      const isWeapon = Math.random() > 0.4;
      this.loot[id] = {
        id, x: Math.random() * MAP_SIZE - MAP_SIZE / 2,
        z: Math.random() * MAP_SIZE - MAP_SIZE / 2,
        type: isWeapon ? weapons[Math.floor(Math.random() * weapons.length)] : items[Math.floor(Math.random() * items.length)],
        ammo: isWeapon ? Math.floor(Math.random() * 30) + 15 : 0,
        picked: false
      };
    }
  }

  generateVehicles() {
    const types = ['Car', 'Motorcycle', 'Boat'];
    const positions = [
      { x: 300, z: 300 }, { x: -300, z: 300 }, { x: 300, z: -300 }, { x: -300, z: -300 },
      { x: 0, z: 500 }, { x: 500, z: 0 }, { x: -500, z: 0 }, { x: 0, z: -500 },
    ];
    positions.forEach((pos, i) => {
      const id = uuidv4();
      this.vehicles[id] = {
        id, x: pos.x, z: pos.z, y: 0,
        type: types[i % types.length],
        rotation: 0, hp: 300, driver: null, speed: 0
      };
    });
  }

  spawnBots() {
    for (let i = 0; i < BOT_COUNT; i++) {
      const id = 'bot_' + uuidv4();
      this.bots[id] = {
        id, name: `Bot_${i + 1}`,
        x: Math.random() * MAP_SIZE - MAP_SIZE / 2,
        y: 0, z: Math.random() * MAP_SIZE - MAP_SIZE / 2,
        hp: 100, armor: 0,
        rotation: Math.random() * Math.PI * 2,
        weapon: 'AR', ammo: 30,
        state: 'looting', // looting, combat, fleeing
        target: null, moveTimer: 0, path: null,
        loot: [], kills: 0, alive: true
      };
    }
  }

  start() {
    this.phase = 'active';
    this.startTime = Date.now();
    this.interval = setInterval(() => this.gameTick(), TICK_RATE);
    this.zoneInterval = setInterval(() => this.shrinkZone(), ZONE_SHRINK_INTERVAL);
    io.to(this.id).emit('gameStart', {
      loot: this.loot, vehicles: this.vehicles,
      zone: this.zone, bots: this.getBotStates()
    });
  }

  getBotStates() {
    return Object.values(this.bots).filter(b => b.alive).map(b => ({
      id: b.id, name: b.name, x: b.x, y: b.y, z: b.z,
      rotation: b.rotation, hp: b.hp, weapon: b.weapon, alive: b.alive
    }));
  }

  shrinkZone() {
    this.zonePhase++;
    const shrinkFactor = 0.6;
    const offset = (Math.random() - 0.5) * this.zone.radius * 0.3;
    this.zone.targetRadius = this.zone.radius * shrinkFactor;
    this.zone.x += offset;
    this.zone.z += offset;
    io.to(this.id).emit('zoneUpdate', { zone: this.zone, phase: this.zonePhase });
  }

  gameTick() {
    this.tick++;
    // Smoothly shrink zone
    if (this.zone.radius > this.zone.targetRadius) {
      this.zone.radius = Math.max(this.zone.radius - 0.5, this.zone.targetRadius);
    }

    // Update bots
    this.updateBots();

    // Update bullets
    this.updateBullets();

    // Zone damage
    this.applyZoneDamage();

    // Check win condition
    this.checkWin();

    // Broadcast game state every 2 ticks
    if (this.tick % 2 === 0) {
      io.to(this.id).emit('gameState', {
        bots: this.getBotStates(),
        bullets: Object.values(this.bullets),
        zone: { radius: this.zone.radius, x: this.zone.x, z: this.zone.z },
        playerCount: Object.keys(this.players).length + Object.values(this.bots).filter(b => b.alive).length
      });
    }
  }

  updateBots() {
    const allPlayers = [...Object.values(this.players), ...Object.values(this.bots).filter(b => b.alive)];
    Object.values(this.bots).filter(b => b.alive).forEach(bot => {
      bot.moveTimer--;
      // Find nearest enemy
      let nearest = null, nearestDist = 9999;
      Object.values(this.players).forEach(p => {
        if (!p.alive) return;
        const d = Math.hypot(p.x - bot.x, p.z - bot.z);
        if (d < nearestDist) { nearestDist = d; nearest = p; }
      });

      // State machine
      if (nearestDist < 200) {
        bot.state = 'combat';
        bot.target = nearest;
      } else if (nearestDist > 400) {
        bot.state = 'looting';
        bot.target = null;
      }

      if (bot.state === 'combat' && bot.target) {
        const t = bot.target;
        const dx = t.x - bot.x, dz = t.z - bot.z;
        bot.rotation = Math.atan2(dx, dz);
        const dist = Math.hypot(dx, dz);
        if (dist > 30) {
          bot.x += (dx / dist) * BOT_SPEED * 0.6;
          bot.z += (dz / dist) * BOT_SPEED * 0.6;
        }
        // Shoot
        if (this.tick % 20 === 0 && dist < 300 && bot.ammo > 0) {
          this.botShoot(bot, t);
          bot.ammo--;
        }
      } else {
        // Wander / loot
        if (bot.moveTimer <= 0) {
          bot.moveTimer = Math.floor(Math.random() * 100) + 50;
          bot.targetX = Math.random() * MAP_SIZE - MAP_SIZE / 2;
          bot.targetZ = Math.random() * MAP_SIZE - MAP_SIZE / 2;
        }
        if (bot.targetX !== undefined) {
          const dx = bot.targetX - bot.x, dz = bot.targetZ - bot.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 5) {
            bot.x += (dx / dist) * BOT_SPEED;
            bot.z += (dz / dist) * BOT_SPEED;
            bot.rotation = Math.atan2(dx, dz);
          }
        }
        // Pick up nearby loot
        Object.values(this.loot).filter(l => !l.picked).forEach(l => {
          if (Math.hypot(l.x - bot.x, l.z - bot.z) < 20) {
            l.picked = true;
            if (BULLET_DAMAGE[l.type]) { bot.weapon = l.type; bot.ammo = 30; }
            if (l.type === 'Heal') bot.hp = Math.min(100, bot.hp + HEAL_AMOUNT);
            if (l.type === 'Armor') bot.armor = Math.min(100, bot.armor + 50);
          }
        });
      }

      // Keep in bounds
      bot.x = Math.max(-MAP_SIZE / 2, Math.min(MAP_SIZE / 2, bot.x));
      bot.z = Math.max(-MAP_SIZE / 2, Math.min(MAP_SIZE / 2, bot.z));
    });
  }

  botShoot(bot, target) {
    const bId = uuidv4();
    const dx = target.x - bot.x, dz = target.z - bot.z;
    const dist = Math.hypot(dx, dz);
    // Add some inaccuracy
    const spread = 0.05;
    this.bullets[bId] = {
      id: bId, ownerId: bot.id, ownerName: bot.name,
      x: bot.x, y: 1.5, z: bot.z,
      vx: (dx / dist + (Math.random() - 0.5) * spread) * BULLET_SPEED * 0.5,
      vz: (dz / dist + (Math.random() - 0.5) * spread) * BULLET_SPEED * 0.5,
      weapon: bot.weapon, ttl: 30, isBot: true
    };
  }

  updateBullets() {
    Object.keys(this.bullets).forEach(id => {
      const b = this.bullets[id];
      b.x += b.vx; b.z += b.vz; b.ttl--;
      if (b.ttl <= 0) { delete this.bullets[id]; return; }
      // Check hit on players
      Object.values(this.players).forEach(p => {
        if (!p.alive || p.id === b.ownerId) return;
        if (Math.hypot(b.x - p.x, b.z - p.z) < 3) {
          const dmg = BULLET_DAMAGE[b.weapon] || 25;
          const armorAbs = Math.min(p.armor, dmg * 0.5);
          p.armor = Math.max(0, p.armor - armorAbs);
          p.hp -= (dmg - armorAbs);
          io.to(p.socketId).emit('takeDamage', { hp: p.hp, armor: p.armor, from: b.ownerName });
          if (p.hp <= 0) {
            p.alive = false;
            p.hp = 0;
            this.killFeed.unshift({ killer: b.ownerName, victim: p.name, weapon: b.weapon, time: Date.now() });
            this.killFeed = this.killFeed.slice(0, 5);
            io.to(p.socketId).emit('playerDied', { killer: b.ownerName });
            io.to(this.id).emit('killFeed', this.killFeed);
            // Drop loot
            this.dropLoot(p.x, p.z, p.loot || []);
          }
          delete this.bullets[id];
        }
      });
      // Check hit on bots
      if (!b.isBot) {
        Object.values(this.bots).filter(bot => bot.alive && bot.id !== b.ownerId).forEach(bot => {
          if (Math.hypot(b.x - bot.x, b.z - bot.z) < 3) {
            const dmg = BULLET_DAMAGE[b.weapon] || 25;
            const armorAbs = Math.min(bot.armor, dmg * 0.5);
            bot.armor = Math.max(0, bot.armor - armorAbs);
            bot.hp -= (dmg - armorAbs);
            // Notify shooter
            const shooter = this.players[b.ownerId];
            if (shooter) {
              io.to(shooter.socketId).emit('hitMarker', { target: bot.name, hp: bot.hp });
            }
            if (bot.hp <= 0) {
              bot.alive = false;
              bot.hp = 0;
              this.killFeed.unshift({ killer: b.ownerName, victim: bot.name, weapon: b.weapon, time: Date.now() });
              this.killFeed = this.killFeed.slice(0, 5);
              io.to(this.id).emit('killFeed', this.killFeed);
              io.to(this.id).emit('botDied', { id: bot.id });
              if (shooter) { shooter.kills++; io.to(shooter.socketId).emit('killConfirmed', { kills: shooter.kills, victim: bot.name }); }
              this.dropLoot(bot.x, bot.z, bot.loot || []);
            }
            delete this.bullets[id];
          }
        });
      }
    });
  }

  dropLoot(x, z, items) {
    const id = uuidv4();
    const types = ['AR', 'SMG', 'Heal', 'Ammo', 'Armor'];
    this.loot[id] = {
      id, x: x + (Math.random() - 0.5) * 10, z: z + (Math.random() - 0.5) * 10,
      type: types[Math.floor(Math.random() * types.length)], ammo: 20, picked: false
    };
    io.to(this.id).emit('lootSpawned', this.loot[id]);
  }

  applyZoneDamage() {
    if (this.tick % 30 !== 0) return;
    const allAlive = [...Object.values(this.players).filter(p => p.alive), ...Object.values(this.bots).filter(b => b.alive)];
    allAlive.forEach(entity => {
      const dist = Math.hypot(entity.x - this.zone.x, entity.z - this.zone.z);
      if (dist > this.zone.radius) {
        entity.hp -= 5;
        if (entity.socketId) {
          io.to(entity.socketId).emit('zoneDamage', { hp: entity.hp });
          if (entity.hp <= 0) {
            entity.alive = false;
            io.to(entity.socketId).emit('playerDied', { killer: 'Zone' });
          }
        } else if (entity.hp <= 0) {
          entity.alive = false;
          entity.hp = 0;
        }
      }
    });
  }

  checkWin() {
    const alivePlayers = Object.values(this.players).filter(p => p.alive);
    const aliveBots = Object.values(this.bots).filter(b => b.alive);
    const totalAlive = alivePlayers.length + aliveBots.length;
    if (totalAlive <= 1 && this.phase === 'active') {
      this.phase = 'ended';
      clearInterval(this.interval);
      clearInterval(this.zoneInterval);
      const winner = alivePlayers[0] || aliveBots[0];
      io.to(this.id).emit('gameOver', {
        winner: winner ? winner.name : 'Unknown',
        isPlayer: !!alivePlayers[0],
        stats: alivePlayers.map(p => ({ name: p.name, kills: p.kills, placement: 1 }))
      });
    }
  }

  addPlayer(socketId, name) {
    // Find spawn in safe zone
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * 400;
    const id = socketId;
    this.players[id] = {
      id, socketId, name,
      x: Math.cos(angle) * dist, y: 0, z: Math.sin(angle) * dist,
      rotation: 0, hp: 100, armor: 0,
      weapon: null, ammo: 0, loot: [],
      kills: 0, alive: true, inVehicle: null,
      lastShot: 0
    };
    return this.players[id];
  }

  removePlayer(socketId) {
    const p = this.players[socketId];
    if (p) {
      p.alive = false;
      delete this.players[socketId];
    }
  }

  shouldStart() {
    return Object.keys(this.players).length >= 1 && this.phase === 'waiting';
  }
}

// ─── Socket Handlers ──────────────────────────────────────────────────────────
let lobbyRoom = null;

function getOrCreateLobby() {
  if (!lobbyRoom || lobbyRoom.phase === 'ended') {
    const id = uuidv4();
    lobbyRoom = new GameRoom(id);
    rooms[id] = lobbyRoom;
  }
  return lobbyRoom;
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  let currentRoom = null;
  let playerName = 'Player_' + socket.id.slice(0, 4);

  socket.on('joinGame', ({ name }) => {
    playerName = name || playerName;
    currentRoom = getOrCreateLobby();
    socket.join(currentRoom.id);
    const player = currentRoom.addPlayer(socket.id, playerName);
    socket.emit('joinedGame', {
      playerId: socket.id, roomId: currentRoom.id,
      mapSize: MAP_SIZE, player,
      loot: currentRoom.loot, vehicles: currentRoom.vehicles,
      zone: currentRoom.zone, phase: currentRoom.phase,
      bots: currentRoom.getBotStates()
    });
    io.to(currentRoom.id).emit('playerJoined', { name: playerName, count: Object.keys(currentRoom.players).length });
    // Auto start after 5s if at least 1 player
    if (currentRoom.shouldStart()) {
      setTimeout(() => {
        if (currentRoom && currentRoom.phase === 'waiting') currentRoom.start();
      }, 5000);
    }
  });

  socket.on('playerMove', (data) => {
    if (!currentRoom) return;
    const p = currentRoom.players[socket.id];
    if (!p || !p.alive) return;
    p.x = data.x; p.y = data.y || 0; p.z = data.z;
    p.rotation = data.rotation;
    // Broadcast to others
    socket.to(currentRoom.id).emit('playerMoved', { id: socket.id, x: p.x, y: p.y, z: p.z, rotation: p.rotation });
  });

  socket.on('shoot', (data) => {
    if (!currentRoom) return;
    const p = currentRoom.players[socket.id];
    if (!p || !p.alive || !p.weapon) return;
    const now = Date.now();
    const cooldowns = { AR: 100, SMG: 80, Sniper: 1200, Shotgun: 600, Pistol: 400 };
    if (now - p.lastShot < (cooldowns[p.weapon] || 200)) return;
    if (p.ammo <= 0) { socket.emit('outOfAmmo'); return; }
    p.lastShot = now;
    p.ammo--;
    const bId = uuidv4();
    currentRoom.bullets[bId] = {
      id: bId, ownerId: socket.id, ownerName: p.name,
      x: data.x, y: data.y || 1.5, z: data.z,
      vx: data.vx, vz: data.vz,
      weapon: p.weapon, ttl: 60, isBot: false
    };
    io.to(currentRoom.id).emit('bulletFired', currentRoom.bullets[bId]);
    socket.emit('ammoUpdate', { ammo: p.ammo });
  });

  socket.on('pickupLoot', ({ lootId }) => {
    if (!currentRoom) return;
    const p = currentRoom.players[socket.id];
    const loot = currentRoom.loot[lootId];
    if (!p || !p.alive || !loot || loot.picked) return;
    const dist = Math.hypot(loot.x - p.x, loot.z - p.z);
    if (dist > 25) return;
    loot.picked = true;
    if (BULLET_DAMAGE[loot.type]) {
      p.weapon = loot.type; p.ammo = loot.ammo;
      socket.emit('weaponPickup', { weapon: loot.type, ammo: loot.ammo });
    } else if (loot.type === 'Heal') {
      p.hp = Math.min(100, p.hp + HEAL_AMOUNT);
      socket.emit('healed', { hp: p.hp });
    } else if (loot.type === 'Armor') {
      p.armor = Math.min(100, p.armor + 50);
      socket.emit('armorPickup', { armor: p.armor });
    } else if (loot.type === 'Ammo') {
      p.ammo = Math.min(p.ammo + 30, 90);
      socket.emit('ammoUpdate', { ammo: p.ammo });
    }
    io.to(currentRoom.id).emit('lootPickedUp', { lootId });
  });

  socket.on('enterVehicle', ({ vehicleId }) => {
    if (!currentRoom) return;
    const p = currentRoom.players[socket.id];
    const v = currentRoom.vehicles[vehicleId];
    if (!p || !p.alive || !v || v.driver) return;
    const dist = Math.hypot(v.x - p.x, v.z - p.z);
    if (dist > 20) return;
    v.driver = socket.id;
    p.inVehicle = vehicleId;
    socket.emit('enteredVehicle', { vehicleId, type: v.type });
    io.to(currentRoom.id).emit('vehicleUpdate', v);
  });

  socket.on('exitVehicle', () => {
    if (!currentRoom) return;
    const p = currentRoom.players[socket.id];
    if (!p || !p.inVehicle) return;
    const v = currentRoom.vehicles[p.inVehicle];
    if (v) v.driver = null;
    p.inVehicle = null;
    socket.emit('exitedVehicle');
  });

  socket.on('vehicleMove', (data) => {
    if (!currentRoom) return;
    const p = currentRoom.players[socket.id];
    if (!p || !p.inVehicle) return;
    const v = currentRoom.vehicles[p.inVehicle];
    if (!v || v.driver !== socket.id) return;
    v.x = data.x; v.z = data.z; v.rotation = data.rotation; v.speed = data.speed;
    p.x = v.x; p.z = v.z;
    socket.to(currentRoom.id).emit('vehicleUpdate', v);
  });

  socket.on('disconnect', () => {
    if (currentRoom) {
      currentRoom.removePlayer(socket.id);
      io.to(currentRoom.id).emit('playerLeft', { id: socket.id });
    }
    console.log('Player disconnected:', socket.id);
  });
});

// ─── REST API ─────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', rooms: Object.keys(rooms).length }));
app.get('/stats', (req, res) => {
  const stats = Object.values(rooms).map(r => ({
    id: r.id, phase: r.phase,
    players: Object.keys(r.players).length,
    bots: Object.values(r.bots).filter(b => b.alive).length
  }));
  res.json(stats);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Operation Frontier Server running on port ${PORT}`));
