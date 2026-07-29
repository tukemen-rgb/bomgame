/* =========================================================
   BLAST RUSH — プレイヤー / 敵 / 爆弾 / アイテム
   ========================================================= */
(function (BM) {
  'use strict';

  var TILE = BM.TILE;
  var nextId = 1;

  /* =========================================================
     共通の移動処理
     グリッドの中心線に吸い付かせることで「通路にスッと入る」
     ボンバーマン特有の操作感を作る。
     ========================================================= */
  function moveAxis(e, dx, dy, game) {
    var moved = false;
    if (dx !== 0) {
      var cy = BM.cellOf(e.y);
      var ty = BM.centerOf(cy);
      var diff = ty - e.y;
      if (Math.abs(diff) > 0.5) {
        var st = Math.sign(diff) * Math.min(Math.abs(diff), Math.abs(dx) * 1.6);
        if (game.canStand(e, e.x, e.y + st)) e.y += st;
      } else {
        e.y = ty;
      }
      if (game.canStand(e, e.x + dx, e.y)) { e.x += dx; moved = true; }
    } else if (dy !== 0) {
      var cx = BM.cellOf(e.x);
      var tx = BM.centerOf(cx);
      var d2 = tx - e.x;
      if (Math.abs(d2) > 0.5) {
        var st2 = Math.sign(d2) * Math.min(Math.abs(d2), Math.abs(dy) * 1.6);
        if (game.canStand(e, e.x + st2, e.y)) e.x += st2;
      } else {
        e.x = tx;
      }
      if (game.canStand(e, e.x, e.y + dy)) { e.y += dy; moved = true; }
    }
    return moved;
  }

  /* =========================================================
     Player
     ========================================================= */
  function Player(cx, cy, opts) {
    this.id = nextId++;
    this.kind = 'player';
    this.x = BM.centerOf(cx);
    this.y = BM.centerOf(cy);
    this.spawnCx = cx; this.spawnCy = cy;
    this.color = opts.color;
    this.color2 = opts.color2;
    this.name = opts.name;
    this.team = opts.team;
    this.controls = opts.controls;
    this.radius = TILE * 0.34;

    this.power = 2;
    this.maxBombs = 1;
    this.activeBombs = 0;
    this.speedLv = 0;
    this.kick = false;
    this.pierce = false;
    this.remote = false;
    this.shield = 0;

    this.lives = opts.lives == null ? 3 : opts.lives;
    this.alive = true;
    this.invuln = 1.2;
    this.dir = 'down';
    this.walkT = 0;
    this.squash = 0;
    this.bombCooldown = 0;
    this.trail = [];
    this.hitFlash = 0;
    this.wins = 0;
    this.stun = 0;
    this.onInk = BM.INK_NONE;
    this.inkStreak = 0;
  }

  /* 自陣のインクの上は速く、敵陣の上は遅い。
     これが「塗る → 動きやすくなる → さらに塗れる」の好循環を作る。 */
  Player.prototype.speed = function (game) {
    var base = BM.BASE_SPEED + this.speedLv * BM.SPEED_STEP;
    if (!game) return base;
    var ink = game.map.inkAt(BM.cellOf(this.x), BM.cellOf(this.y));
    this.onInk = ink;
    if (ink === this.team) return base * (1 + BM.INK_SPEED_BONUS);
    if (ink !== BM.INK_NONE) return base * (1 + BM.INK_SPEED_PENALTY);
    return base;
  };

  Player.prototype.update = function (dt, game) {
    if (!this.alive) return;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.stun > 0) {
      this.stun -= dt;
      this.walkT += dt * 18;
      return;
    }
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.bombCooldown > 0) this.bombCooldown -= dt;
    this.squash = BM.damp(this.squash, 0, 12, dt);

    var c = this.controls;
    var K = BM.input.keys;
    var ix = (K[c.right] ? 1 : 0) - (K[c.left] ? 1 : 0);
    var iy = (K[c.down] ? 1 : 0) - (K[c.up] ? 1 : 0);

    // 同時押しは「後から押した方」を優先
    if (ix !== 0 && iy !== 0) {
      if (BM.input.axisPriority[this.id] === 'y') ix = 0; else iy = 0;
    } else if (ix !== 0) BM.input.axisPriority[this.id] = 'x';
    else if (iy !== 0) BM.input.axisPriority[this.id] = 'y';

    var sp = this.speed(game) * dt;
    var moved = false;
    if (ix !== 0) {
      this.dir = ix > 0 ? 'right' : 'left';
      moved = moveAxis(this, ix * sp, 0, game);
      if (!moved && game.blockedByBomb && this.kick) game.kickBomb(game.blockedByBomb, ix, 0, this);
    } else if (iy !== 0) {
      this.dir = iy > 0 ? 'down' : 'up';
      moved = moveAxis(this, 0, iy * sp, game);
      if (!moved && game.blockedByBomb && this.kick) game.kickBomb(game.blockedByBomb, 0, iy, this);
    }

    if (moved) {
      this.walkT += dt * (6 + this.speedLv * 1.1);
      var fast = this.onInk === this.team;
      if (this.speedLv >= 3 || fast) {
        this.trail.push({ x: this.x, y: this.y, t: 0 });
        if (this.trail.length > 10) this.trail.shift();
      }
      if (fast && Math.random() < dt * 22) {
        // 自陣を走るとインクが跳ねる
        BM.fx.spawn(1, {
          x: this.x, y: this.y + TILE * 0.28, jitter: 5,
          speedMin: 20, speedMax: 70, rMin: 1.2, rMax: 2.6,
          lifeMin: 0.2, lifeMax: 0.4, drag: 2.4, gravity: 240,
          colors: [BM.TEAMS[this.team].ink, '#ffffff'], glow: false
        });
      } else if (Math.random() < dt * 12) BM.fx.dust(this.x, this.y + TILE * 0.32);
    } else {
      this.walkT = BM.damp(this.walkT, Math.round(this.walkT), 10, dt);
    }
    for (var i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].t += dt;
      if (this.trail[i].t > 0.24) this.trail.splice(i, 1);
    }

    if (BM.input.pressed(c.bomb) && this.bombCooldown <= 0) {
      if (game.placeBomb(this)) { this.bombCooldown = 0.1; this.squash = 1; }
    }
    if (BM.input.pressed(c.detonate) && this.remote) game.detonateRemote(this);
  };

  Player.prototype.gainItem = function (type, game) {
    var I = BM.ITEMS;
    switch (type) {
      case I.FIRE.key:   this.power = Math.min(BM.MAX_POWER, this.power + 1); break;
      case I.BOMB.key:   this.maxBombs = Math.min(BM.MAX_BOMBS, this.maxBombs + 1); break;
      case I.SPEED.key:  this.speedLv = Math.min(BM.MAX_SPEED_LV, this.speedLv + 1); break;
      case I.KICK.key:   this.kick = true; break;
      case I.PIERCE.key: this.pierce = true; break;
      case I.REMOTE.key: this.remote = true; break;
      case I.HEART.key:  this.lives++; break;
      case I.FULL.key:   this.power = BM.MAX_POWER; break;
      case I.SHIELD.key: this.shield = Math.min(3, this.shield + 1); break;
    }
  };

  /* =========================================================
     Enemy
     ========================================================= */
  var ENEMY_DEF = {
    balloon: { speed: 62,  hp: 1, score: 100, color: '#ff8fa3', dark: '#a33b52', brain: 'wander', eyes: 2 },
    chaser:  { speed: 88,  hp: 1, score: 200, color: '#7ad4ff', dark: '#2f6f96', brain: 'chase',  eyes: 2 },
    ghost:   { speed: 70,  hp: 1, score: 300, color: '#c9a6ff', dark: '#5c3d94', brain: 'ghost',  eyes: 2, phase: true },
    bomber:  { speed: 96,  hp: 2, score: 500, color: '#ffd166', dark: '#a06a1a', brain: 'bomber', eyes: 2 }
  };
  BM.ENEMY_DEF = ENEMY_DEF;

  function Enemy(cx, cy, type) {
    var d = ENEMY_DEF[type];
    this.id = nextId++;
    this.kind = 'enemy';
    this.type = type;
    this.def = d;
    this.x = BM.centerOf(cx);
    this.y = BM.centerOf(cy);
    this.radius = TILE * 0.3;
    this.baseSpeed = d.speed;
    this.hp = d.hp;
    this.alive = true;
    this.dirVec = BM.pick(BM.DIRS);
    this.target = null;
    this.think = 0;
    this.bob = Math.random() * 6;
    this.hurtFlash = 0;
    this.enraged = false;
    this.bombCooldown = BM.rand(1.5, 4);
    this.activeBombs = 0;
    this.maxBombs = 1;
    this.power = 2;
    this.pierce = false;
    this.spawnFade = 0.45;
    this.team = BM.ENEMY_TEAM;
    this.stainT = Math.random() * BM.STAIN_INTERVAL;
  }

  Enemy.prototype.speed = function () {
    return this.baseSpeed * (this.enraged ? 1.55 : 1);
  };

  Enemy.prototype.passable = function (cx, cy, game) {
    var t = game.map.at(cx, cy);
    if (t === BM.T_WALL) return false;
    if (t === BM.T_BLOCK) return !!this.def.phase;
    if (game.bombAt(cx, cy)) return false;
    return true;
  };

  Enemy.prototype.update = function (dt, game) {
    if (!this.alive) return;
    if (this.spawnFade > 0) { this.spawnFade -= dt; return; }
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.bombCooldown > 0) this.bombCooldown -= dt;
    this.bob += dt * 5;

    var cx = BM.cellOf(this.x), cy = BM.cellOf(this.y);

    // 歩いた跡を敵チームの色に汚していく。放置すると塗り率がじりじり削られる。
    this.stainT -= dt;
    if (this.stainT <= 0) {
      this.stainT = BM.STAIN_INTERVAL;
      if (game.map.paint(cx, cy, this.team)) {
        game.onPainted(this.team, 1, this.x, this.y, null);
        BM.fx.spawn(2, {
          x: this.x, y: this.y + 8, jitter: 7,
          speedMin: 8, speedMax: 40, rMin: 1.2, rMax: 2.4,
          lifeMin: 0.2, lifeMax: 0.45, drag: 2.6, gravity: 120,
          colors: [BM.TEAMS[this.team].ink], glow: false
        });
      }
    }

    var atCenter = Math.abs(this.x - BM.centerOf(cx)) < 1.2 && Math.abs(this.y - BM.centerOf(cy)) < 1.2;

    if (!this.target || atCenter) {
      this.x = BM.centerOf(cx); this.y = BM.centerOf(cy);
      this.decide(game, cx, cy);
    }

    if (this.target) {
      var tx = BM.centerOf(this.target.x), ty = BM.centerOf(this.target.y);
      var sp = this.speed() * dt;
      var dx = tx - this.x, dy = ty - this.y;
      var dist = Math.hypot(dx, dy);
      if (dist <= sp) {
        this.x = tx; this.y = ty;
        this.target = null;
      } else {
        this.x += dx / dist * sp;
        this.y += dy / dist * sp;
      }
    }
  };

  Enemy.prototype.decide = function (game, cx, cy) {
    var self = this;
    var danger = game.danger;
    var W = BM.COLS;
    var pass = function (nx, ny) { return self.passable(nx, ny, game); };
    var safePass = function (nx, ny) { return pass(nx, ny) && danger[ny * W + nx] === 0; };

    // 1) 危険地帯にいるなら、まず逃げる
    if (danger[cy * W + cx] > 0) {
      var esc = game.map.bfsStep(cx, cy, function (nx, ny) {
        return danger[ny * W + nx] === 0;
      }, pass, 12);
      if (esc) { this.target = esc; return; }
    }

    // 2) 爆弾を置く判断（bomber のみ）
    if (this.def.brain === 'bomber' && this.bombCooldown <= 0 && this.activeBombs < this.maxBombs) {
      var tgt = game.nearestPlayer(this.x, this.y);
      if (tgt) {
        var pcx = BM.cellOf(tgt.x), pcy = BM.cellOf(tgt.y);
        var aligned = (pcx === cx && Math.abs(pcy - cy) <= this.power) ||
                      (pcy === cy && Math.abs(pcx - cx) <= this.power);
        var nearBlock = game.map.isBlock(cx + 1, cy) || game.map.isBlock(cx - 1, cy) ||
                        game.map.isBlock(cx, cy + 1) || game.map.isBlock(cx, cy - 1);
        if ((aligned || (nearBlock && Math.random() < 0.35)) && game.enemyHasEscape(this, cx, cy)) {
          game.placeBomb(this);
          this.bombCooldown = BM.rand(2.4, 4.2);
          // 置いた直後は自分で作った危険から逃げる
          game.rebuildDanger();
          var esc2 = game.map.bfsStep(cx, cy, function (nx, ny) {
            return game.danger[ny * W + nx] === 0;
          }, pass, 12);
          if (esc2) { this.target = esc2; return; }
        }
      }
    }

    // 3) 追跡
    if (this.def.brain === 'chase' || this.def.brain === 'bomber' || this.def.brain === 'ghost') {
      var p = game.nearestPlayer(this.x, this.y);
      if (p) {
        var gx = BM.cellOf(p.x), gy = BM.cellOf(p.y);
        var d = Math.abs(gx - cx) + Math.abs(gy - cy);
        var range = this.def.brain === 'ghost' ? 20 : 11;
        if (d <= range) {
          var step = game.map.bfsStep(cx, cy, function (nx, ny) {
            return nx === gx && ny === gy;
          }, safePass, 16);
          if (step) { this.target = step; return; }
        }
      }
    }

    // 4) ふらふら歩く（今の向きを優先して直進しやすくする）
    var opts = [];
    for (var i = 0; i < 4; i++) {
      var d2 = BM.DIRS[i];
      var nx2 = cx + d2.x, ny2 = cy + d2.y;
      if (!safePass(nx2, ny2)) continue;
      var weight = 1;
      if (d2.x === this.dirVec.x && d2.y === this.dirVec.y) weight = 5;
      else if (d2.x === -this.dirVec.x && d2.y === -this.dirVec.y) weight = 0.4;
      opts.push({ d: d2, w: weight, cell: { x: nx2, y: ny2 } });
    }
    if (!opts.length) { this.target = null; return; }
    var total = 0; for (var j = 0; j < opts.length; j++) total += opts[j].w;
    var r = Math.random() * total;
    for (var k = 0; k < opts.length; k++) {
      r -= opts[k].w;
      if (r <= 0) { this.dirVec = opts[k].d; this.target = opts[k].cell; return; }
    }
    this.dirVec = opts[0].d; this.target = opts[0].cell;
  };

  /* =========================================================
     Bomb
     ========================================================= */
  function Bomb(cx, cy, owner) {
    this.id = nextId++;
    this.kind = 'bomb';
    this.cx = cx; this.cy = cy;
    this.x = BM.centerOf(cx);
    this.y = BM.centerOf(cy);
    this.owner = owner;
    this.team = owner.team;
    this.power = owner.power;
    this.pierce = !!owner.pierce;
    this.remote = !!owner.remote;
    this.fuse = this.remote ? 9999 : BM.BOMB_FUSE;
    this.t = 0;
    this.exploded = false;
    this.pass = {};       // まだ重なっている entity id
    this.slide = null;    // キックによる移動方向
    this.chainedBy = 0;
  }

  Bomb.prototype.update = function (dt, game) {
    this.t += dt;
    this.fuse -= dt;

    if (this.slide) {
      var sp = BM.KICK_SPEED * dt;
      var nx = this.x + this.slide.x * sp;
      var ny = this.y + this.slide.y * sp;
      var ncx = BM.cellOf(nx + this.slide.x * TILE * 0.45);
      var ncy = BM.cellOf(ny + this.slide.y * TILE * 0.45);
      var blocked = game.map.at(ncx, ncy) !== BM.T_EMPTY ||
                    (game.bombAt(ncx, ncy) && game.bombAt(ncx, ncy) !== this) ||
                    game.entityAtCell(ncx, ncy, this.owner);
      if (blocked && (ncx !== this.cx || ncy !== this.cy)) {
        this.x = BM.centerOf(this.cx); this.y = BM.centerOf(this.cy);
        this.slide = null;
        BM.fx.dust(this.x, this.y);
      } else {
        this.x = nx; this.y = ny;
        this.cx = BM.cellOf(this.x); this.cy = BM.cellOf(this.y);
        // 直交方向はレールに乗せる
        if (this.slide.x) this.y = BM.centerOf(this.cy);
        else this.x = BM.centerOf(this.cx);
      }
    }
    return this.fuse <= 0;
  };

  /* =========================================================
     Item
     ========================================================= */
  function Item(cx, cy, type) {
    this.cx = cx; this.cy = cy;
    this.x = BM.centerOf(cx); this.y = BM.centerOf(cy);
    this.type = type;
    this.t = Math.random() * 3;
    this.alive = true;
    this.pop = 0.35;
  }

  BM.Player = Player;
  BM.Enemy = Enemy;
  BM.Bomb = Bomb;
  BM.Item = Item;
  BM.moveAxis = moveAxis;
})(BM);
