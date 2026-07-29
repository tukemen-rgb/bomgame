/* =========================================================
   BLAST RUSH — ゲーム本体（ロジック + 描画）
   ========================================================= */
(function (BM) {
  'use strict';

  var TILE = BM.TILE, COLS = BM.COLS, ROWS = BM.ROWS;
  var W = BM.BOARD_W, H = BM.BOARD_H;

  function Game(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // 揺れ・色ズレのために一度オフスクリーンへ描く
    this.buf = document.createElement('canvas');
    this.buf.width = W; this.buf.height = H;
    this.bctx = this.buf.getContext('2d');
    this.tmp = document.createElement('canvas');
    this.tmp.width = W; this.tmp.height = H;
    this.tctx = this.tmp.getContext('2d');

    this.fx = BM.fx = new BM.FX();
    this.map = new BM.GameMap();

    this.state = BM.S_TITLE;
    this.mode = 'solo';
    this.players = [];
    this.enemies = [];
    this.bombs = [];
    this.flames = [];
    this.items = [];
    this.door = null;

    this.flameGrid = new Float32Array(COLS * ROWS);
    this.danger = new Uint8Array(COLS * ROWS);

    this.score = 0;
    this.stage = 1;
    this.timeLeft = 200;
    this.hitStop = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.chainCount = 0;
    this.introT = 0;
    this.stateT = 0;
    this.blockedByBomb = null;
    this.bestScore = Number(BM.store.get('blastrush.best', 0)) || 0;
    this.roundWinner = null;
    this.timeUpDone = false;
    this.lastTickSec = -1;
    this.doorHintCell = null;
    this.hidden = {};
    this.targetRatio = 0.55;
    this.myRatio = 0;
    this.foeRatio = 0;
    this.inkCounts = { 1: 0, 2: 0, total: 1 };
    this.inkGain = { 1: 0, 2: 0 };

    this.bgPhase = 0;

    // タイトル画面の背景として、飾りのステージを生成しておく
    this.map.generate(0.42, []);
  }

  Game.prototype.toTitle = function () {
    this.state = BM.S_TITLE;
    this.stateT = 0;
    this.players = [];
    this.clearField();
    this.map.generate(0.42, []);
  };

  /* =========================================================
     セットアップ
     ========================================================= */

  Game.prototype.newRun = function (mode) {
    this.mode = mode;
    this.score = 0;
    this.stage = 1;
    this.combo = 0;
    if (mode === 'vs') {
      this.vsScore = [0, 0];
      this.startVsRound();
    } else {
      this.startStage(1, true);
    }
  };

  Game.prototype.makePlayers = function (n, keepStats) {
    var old = this.players;
    var ps = [];
    ps.push(new BM.Player(1, 1, {
      color: '#7fe3ff', color2: '#1a6f9e', name: '1P', team: 1,
      controls: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', bomb: ' ', detonate: 'Enter' }
    }));
    if (n > 1) {
      ps.push(new BM.Player(COLS - 2, ROWS - 2, {
        color: '#ff9ada', color2: '#a53a80', name: '2P', team: 2,
        controls: { up: 'w', down: 's', left: 'a', right: 'd', bomb: 'f', detonate: 'g' }
      }));
    }
    if (keepStats && old.length) {
      for (var i = 0; i < ps.length && i < old.length; i++) {
        var o = old[i], p = ps[i];
        p.power = o.power; p.maxBombs = o.maxBombs; p.speedLv = o.speedLv;
        p.kick = o.kick; p.pierce = o.pierce; p.remote = o.remote;
        p.lives = o.lives; p.shield = o.shield; p.wins = o.wins;
      }
    }
    this.players = ps;
  };

  Game.prototype.clearField = function () {
    this.enemies.length = 0;
    this.bombs.length = 0;
    this.flames.length = 0;
    this.items.length = 0;
    this.flameGrid.fill(0);
    this.danger.fill(0);
    this.door = null;
    this.doorHintCell = null;
    this.hidden = this.hidden || {};
    this.fx.clear();
    this.combo = 0; this.comboTimer = 0; this.chainCount = 0;
  };

  Game.prototype.startStage = function (n, fresh) {
    this.stage = n;
    var def = BM.stageDef(n);
    this.clearField();
    this.makePlayers(1, !fresh);
    if (fresh) {
      this.players[0].lives = 3;
      this.players[0].power = 2;
    }

    var clear = [
      { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 3, y: 1 }, { x: 1, y: 3 }
    ];
    this.map.generate(def.density, clear);

    // ソフトブロックの下にアイテムを隠す
    var blocks = BM.shuffle(this.map.blockCells());
    this.hidden = {};
    var itemPool = this.buildItemPool(def, blocks.length);
    for (var i = 0; i < itemPool.length && i < blocks.length; i++) {
      this.hidden[BM.key(blocks[i].x, blocks[i].y)] = { item: itemPool[i] };
    }

    // 出口は最初から見えている。開くのは「敵全滅」ではなくノルマ塗り率の達成。
    this.targetRatio = BM.targetRatio(n);
    var open = this.map.freeCells(false).filter(function (c) {
      return (Math.abs(c.x - 1) + Math.abs(c.y - 1)) >= 8;
    });
    var doorCell = open.length ? BM.pick(open) : { x: COLS - 2, y: ROWS - 2 };
    this.door = { cx: doorCell.x, cy: doorCell.y, t: 0, open: false };

    // 陣地の種：お互いのスタート地点だけ最初から塗っておく
    this.map.paint(1, 1, 1); this.map.paint(2, 1, 1); this.map.paint(1, 2, 1);

    // 敵配置：プレイヤーから十分離す
    var spots = this.map.freeCells(false).filter(function (c) {
      return (Math.abs(c.x - 1) + Math.abs(c.y - 1)) >= 6;
    });
    BM.shuffle(spots);
    for (var e = 0; e < def.enemies.length && e < spots.length; e++) {
      this.enemies.push(new BM.Enemy(spots[e].x, spots[e].y, def.enemies[e]));
    }

    this.timeLeft = def.time;
    this.timeUpDone = false;
    this.introT = 1.6;
    this.state = BM.S_PLAY;
    this.stateT = 0;
    this.rebuildDanger();
    BM.sound.setTempo(138 + Math.min(n, 10) * 3);
  };

  Game.prototype.buildItemPool = function (def, blockCount) {
    var I = BM.ITEMS;
    var pool = [];
    var total = Math.round(blockCount * def.itemChance);
    var weights = [
      [I.FIRE.key, 30], [I.BOMB.key, 26], [I.SPEED.key, 14],
      [I.KICK.key, 8], [I.PIERCE.key, 5], [I.REMOTE.key, 4],
      [I.SHIELD.key, 6], [I.HEART.key, 3], [I.FULL.key, 4]
    ];
    var sum = 0; weights.forEach(function (w) { sum += w[1]; });
    for (var i = 0; i < total; i++) {
      var r = Math.random() * sum;
      for (var j = 0; j < weights.length; j++) {
        r -= weights[j][1];
        if (r <= 0) { pool.push(weights[j][0]); break; }
      }
    }
    // 序盤に火力と爆弾が必ず出るよう保証
    if (pool.length >= 2) { pool[0] = I.FIRE.key; pool[1] = I.BOMB.key; }
    return BM.shuffle(pool);
  };

  Game.prototype.startVsRound = function () {
    this.clearField();
    this.makePlayers(2, false);
    this.players.forEach(function (p) { p.lives = 1; p.power = 2; p.maxBombs = 1; });
    var clear = [
      { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 },
      { x: COLS - 2, y: ROWS - 2 }, { x: COLS - 3, y: ROWS - 2 }, { x: COLS - 2, y: ROWS - 3 }
    ];
    this.map.generate(0.44, clear);
    var blocks = BM.shuffle(this.map.blockCells());
    this.hidden = {};
    var pool = this.buildItemPool({ itemChance: 0.42 }, blocks.length);
    for (var i = 0; i < pool.length && i < blocks.length; i++) {
      this.hidden[BM.key(blocks[i].x, blocks[i].y)] = { item: pool[i] };
    }
    this.map.paint(1, 1, 1); this.map.paint(2, 1, 1); this.map.paint(1, 2, 1);
    this.map.paint(COLS - 2, ROWS - 2, 2); this.map.paint(COLS - 3, ROWS - 2, 2); this.map.paint(COLS - 2, ROWS - 3, 2);
    this.targetRatio = 0;
    this.timeLeft = 100;
    this.timeUpDone = false;
    this.introT = 1.6;
    this.state = BM.S_PLAY;
    this.stateT = 0;
    this.roundWinner = null;
    this.rebuildDanger();
  };

  /* =========================================================
     当たり判定ヘルパ
     ========================================================= */

  Game.prototype.bombAt = function (cx, cy) {
    for (var i = 0; i < this.bombs.length; i++) {
      var b = this.bombs[i];
      if (b.cx === cx && b.cy === cy) return b;
    }
    return null;
  };

  Game.prototype.entityAtCell = function (cx, cy, except) {
    var i, e;
    for (i = 0; i < this.players.length; i++) {
      e = this.players[i];
      if (e !== except && e.alive && BM.cellOf(e.x) === cx && BM.cellOf(e.y) === cy) return e;
    }
    for (i = 0; i < this.enemies.length; i++) {
      e = this.enemies[i];
      if (e !== except && e.alive && BM.cellOf(e.x) === cx && BM.cellOf(e.y) === cy) return e;
    }
    return null;
  };

  Game.prototype.canStand = function (ent, x, y) {
    this.blockedByBomb = null;
    var r = ent.radius;
    var pts = [
      [x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]
    ];
    for (var i = 0; i < pts.length; i++) {
      var cx = BM.cellOf(pts[i][0]), cy = BM.cellOf(pts[i][1]);
      var t = this.map.at(cx, cy);
      if (t === BM.T_WALL) return false;
      if (t === BM.T_BLOCK) { if (!(ent.def && ent.def.phase)) return false; }
      var b = this.bombAt(cx, cy);
      if (b && !b.pass[ent.id]) { this.blockedByBomb = b; return false; }
    }
    return true;
  };

  Game.prototype.nearestPlayer = function (x, y) {
    var best = null, bd = 1e9;
    for (var i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.alive) continue;
      var d = Math.abs(p.x - x) + Math.abs(p.y - y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  /* =========================================================
     爆弾
     ========================================================= */

  Game.prototype.placeBomb = function (owner) {
    if (owner.activeBombs >= owner.maxBombs) return false;
    var cx = BM.cellOf(owner.x), cy = BM.cellOf(owner.y);
    if (this.map.at(cx, cy) !== BM.T_EMPTY) return false;
    if (this.bombAt(cx, cy)) return false;

    var b = new BM.Bomb(cx, cy, owner);
    // 設置した本人は最初だけすり抜けられる
    var all = this.players.concat(this.enemies);
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (BM.cellOf(e.x) === cx && BM.cellOf(e.y) === cy) b.pass[e.id] = true;
    }
    this.bombs.push(b);
    owner.activeBombs++;
    if (owner.kind === 'player') {
      BM.sound.place();
      this.fx.sparkle(b.x, b.y, '#ffd23d');
    }
    this.rebuildDanger();
    return true;
  };

  Game.prototype.kickBomb = function (bomb, dx, dy, by) {
    if (!bomb || bomb.slide) return;
    var ncx = bomb.cx + dx, ncy = bomb.cy + dy;
    if (this.map.at(ncx, ncy) !== BM.T_EMPTY) return;
    if (this.bombAt(ncx, ncy)) return;
    bomb.slide = { x: dx, y: dy };
    BM.sound.kick();
    this.fx.dust(bomb.x, bomb.y);
  };

  Game.prototype.detonateRemote = function (owner) {
    var any = false;
    for (var i = 0; i < this.bombs.length; i++) {
      var b = this.bombs[i];
      if (b.owner === owner && b.remote && !b.exploded) { b.fuse = 0.0001; any = true; }
    }
    if (any) BM.sound.blip(true);
  };

  Game.prototype.blastCells = function (cx, cy, power, pierce) {
    var cells = [{ x: cx, y: cy, kind: 'center', dist: 0, dir: null }];
    for (var d = 0; d < 4; d++) {
      var dir = BM.DIRS[d];
      for (var i = 1; i <= power; i++) {
        var nx = cx + dir.x * i, ny = cy + dir.y * i;
        var t = this.map.at(nx, ny);
        if (t === BM.T_WALL) break;
        if (t === BM.T_BLOCK) {
          cells.push({ x: nx, y: ny, kind: 'block', dist: i, dir: dir });
          if (!pierce) break;
          continue;
        }
        cells.push({ x: nx, y: ny, kind: i === power ? 'tip' : 'arm', dist: i, dir: dir });
      }
    }
    return cells;
  };

  Game.prototype.explode = function (bomb) {
    if (bomb.exploded) return;
    bomb.exploded = true;
    if (bomb.owner) bomb.owner.activeBombs = Math.max(0, bomb.owner.activeBombs - 1);

    var cells = this.blastCells(bomb.cx, bomb.cy, bomb.power, bomb.pierce);

    // 連鎖カウント
    if (this.comboTimer > 0) this.chainCount++;
    else this.chainCount = 1;
    this.comboTimer = BM.COMBO_WINDOW;

    var brokeAny = false;
    var painted = 0;
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var delay = c.dist * 0.016;

      this.flames.push({
        cx: c.x, cy: c.y, kind: c.kind, dir: c.dir,
        t: -delay, life: BM.FLAME_LIFE, power: bomb.power,
        team: bomb.team, core: c.kind === 'center'
      });

      if (c.kind === 'block') {
        this.breakBlock(c.x, c.y, bomb.owner);
        brokeAny = true;
      }
      // ★ このゲームの核：爆風が通ったマスは自分の色になる
      if (this.map.paint(c.x, c.y, bomb.team)) painted++;
      // 誘爆
      var ob = this.bombAt(c.x, c.y);
      if (ob && ob !== bomb && !ob.exploded && ob.fuse > BM.CHAIN_DELAY) {
        ob.fuse = BM.CHAIN_DELAY + delay;
      }
      // アイテムは爆風で消える（配置の駆け引きを作る）
      for (var j = this.items.length - 1; j >= 0; j--) {
        var it = this.items[j];
        if (it.cx === c.x && it.cy === c.y && it.pop <= 0) {
          this.items.splice(j, 1);
          this.fx.sparkle(it.x, it.y, '#888');
        }
      }
    }

    // ---- 演出 ----
    var mag = 4 + bomb.power * 1.1 + Math.min(this.chainCount, 6) * 1.4;
    this.fx.addShake(mag);
    this.fx.addFlash(0.14 + Math.min(this.chainCount, 5) * 0.03, '255,190,120');
    this.fx.addAberration(1.4 + Math.min(this.chainCount, 5) * 0.5);
    this.fx.explosionBurst(bomb.x, bomb.y, bomb.power);
    this.hitStop = Math.max(this.hitStop, 0.045 + Math.min(this.chainCount, 5) * 0.008);
    BM.sound.explosion(bomb.power);
    if (this.chainCount >= 2) {
      BM.sound.chain(this.chainCount);
      this.fx.text(bomb.x, bomb.y - 30, this.chainCount + ' CHAIN', '#ffd23d', 16);
      if (this.chainCount >= 3) BM.ui.combo(this.chainCount + ' 連鎖!!');
    }
    if (brokeAny) BM.sound.breakBlock();
    this.onPainted(bomb.team, painted, bomb.x, bomb.y, bomb.owner);
  };

  /* 塗れたときの共通処理。スコアと演出はここに集約する。 */
  Game.prototype.onPainted = function (team, n, x, y, owner) {
    var t = BM.TEAMS[team];
    if (n <= 0 || !t) return;
    this.inkGain[team] = (this.inkGain[team] || 0) + n;

    // インクのしぶき
    this.fx.spawn(Math.min(26, 4 + n * 2), {
      x: x, y: y, jitter: 10,
      speedMin: 40, speedMax: 60 + n * 14,
      rMin: 1.6, rMax: 4.4, lifeMin: 0.25, lifeMax: 0.6,
      drag: 2.6, gravity: 320, glow: false,
      colors: [t.ink, t.deep, '#ffffff']
    });

    if (owner && owner.kind === 'player') {
      var gained = this.addScore(n * 12, x, y, true);
      this.fx.text(x, y - 12, '+' + n + ' 塗', t.ink, n >= 8 ? 19 : 15);
      if (n >= 12) BM.ui.combo(n + ' マス一気塗り!');
      if (gained) { /* スコアは addScore 側で加算済み */ }
    }
  };

  Game.prototype.breakBlock = function (cx, cy, owner) {
    if (this.map.at(cx, cy) !== BM.T_BLOCK) return;
    this.map.set(cx, cy, BM.T_EMPTY);
    var px = BM.centerOf(cx), py = BM.centerOf(cy);
    this.fx.blockShatter(px, py);

    if (owner && owner.kind === 'player' && this.mode === 'solo') this.addScore(10, 0, 0, true);

    var h = this.hidden && this.hidden[BM.key(cx, cy)];
    if (h) {
      if (h.item) {
        this.items.push(new BM.Item(cx, cy, h.item));
        this.fx.sparkle(px, py, BM.ITEMS[h.item].color);
      }
      delete this.hidden[BM.key(cx, cy)];
    }
  };

  /* 菱形にインクをまき散らす（撃破時・やられた時の中立化に使う） */
  Game.prototype.splashInk = function (cx, cy, radius, team, px, py) {
    var n = 0;
    for (var dy = -radius; dy <= radius; dy++) {
      for (var dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > radius) continue;
        if (this.map.paint(cx + dx, cy + dy, team)) n++;
      }
    }
    if (n && px != null) this.onPainted(team, n, px, py, this.players[0]);
    return n;
  };

  /* やられた地点の自陣を中立に戻す。死のコストを「陣地」で払わせる。 */
  Game.prototype.wipeInk = function (cx, cy, radius, team) {
    var n = 0;
    for (var dy = -radius; dy <= radius; dy++) {
      for (var dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > radius) continue;
        var x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
        var i = y * COLS + x;
        if (this.map.ink[i] === team) { this.map.ink[i] = BM.INK_NONE; this.map.inkT[i] = 0; n++; }
      }
    }
    return n;
  };

  /* 敵が爆弾を置いた時に逃げ場があるか */
  Game.prototype.enemyHasEscape = function (enemy, cx, cy) {
    var blast = this.blastCells(cx, cy, enemy.power, enemy.pierce);
    var danger = {};
    for (var i = 0; i < blast.length; i++) danger[BM.key(blast[i].x, blast[i].y)] = true;
    var self = this;
    var d = this.danger;
    var step = this.map.bfsStep(cx, cy, function (nx, ny) {
      return !danger[BM.key(nx, ny)] && d[ny * COLS + nx] === 0;
    }, function (nx, ny) {
      return enemy.passable(nx, ny, self);
    }, 6);
    return !!step;
  };

  Game.prototype.rebuildDanger = function () {
    this.danger.fill(0);
    var i, j;
    for (i = 0; i < this.bombs.length; i++) {
      var b = this.bombs[i];
      if (b.exploded) continue;
      var cells = this.blastCells(b.cx, b.cy, b.power, b.pierce);
      for (j = 0; j < cells.length; j++) {
        this.danger[cells[j].y * COLS + cells[j].x] = 1;
      }
    }
    for (i = 0; i < this.flameGrid.length; i++) {
      if (this.flameGrid[i] > 0) this.danger[i] = 2;
    }
  };

  /* =========================================================
     スコア
     ========================================================= */
  Game.prototype.addScore = function (base, x, y, silent) {
    var mult = Math.max(1, this.combo);
    var gained = base * mult;
    this.score += gained;
    if (!silent) {
      this.fx.text(x, y - 12, '+' + gained + (mult > 1 ? ' ×' + mult : ''), mult > 1 ? '#ff9adf' : '#ffe14d', mult > 1 ? 17 : 14);
    }
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      BM.store.set('blastrush.best', String(this.bestScore));
    }
    return gained;
  };

  /* =========================================================
     更新
     ========================================================= */

  Game.prototype.update = function (dt) {
    this.bgPhase += dt;

    if (this.state !== BM.S_PLAY) {
      this.stateT += dt;
      // ステージ名の演出中に決着がついても、そのまま消えるようにする
      if (this.introT > 0) this.introT -= dt;
      this.fx.update(dt);
      return;
    }

    // ヒットストップ（実際は超スローで、止まるより気持ちいい）
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      dt *= 0.18;
    }
    this.stateT += dt;
    if (this.introT > 0) this.introT -= dt;
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) { this.combo = 0; this.chainCount = 0; }
    }

    // ---- 時間 ----
    if (!this.timeUpDone) {
      this.timeLeft -= dt;
      var sec = Math.ceil(this.timeLeft);
      if (sec <= 10 && sec !== this.lastTickSec && sec > 0) { BM.sound.tick(); this.lastTickSec = sec; }
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.timeUpDone = true;
        this.onTimeUp();
      }
    }

    var i, j;

    // ---- 爆弾 ----
    for (i = this.bombs.length - 1; i >= 0; i--) {
      var b = this.bombs[i];
      // すり抜け解除判定
      for (var idKey in b.pass) {
        var ent = this.findEntity(Number(idKey));
        if (!ent || !ent.alive) { delete b.pass[idKey]; continue; }
        if (BM.cellOf(ent.x) !== b.cx || BM.cellOf(ent.y) !== b.cy) delete b.pass[idKey];
      }
      if (b.update(dt, this)) {
        this.explode(b);
        this.bombs.splice(i, 1);
      }
    }

    // ---- 爆風 ----
    this.flameGrid.fill(0);
    for (i = this.flames.length - 1; i >= 0; i--) {
      var f = this.flames[i];
      f.t += dt;
      if (f.t >= f.life) { this.flames.splice(i, 1); continue; }
      if (f.t >= 0) this.flameGrid[f.cy * COLS + f.cx] = 1;
    }

    this.rebuildDanger();

    // ---- プレイヤー ----
    for (i = 0; i < this.players.length; i++) this.players[i].update(dt, this);

    // ---- 敵 ----
    for (i = 0; i < this.enemies.length; i++) this.enemies[i].update(dt, this);

    // ---- アイテム取得 ----
    for (i = this.items.length - 1; i >= 0; i--) {
      var it = this.items[i];
      if (it.pop > 0) { it.pop -= dt; continue; }
      it.t += dt;
      for (j = 0; j < this.players.length; j++) {
        var p = this.players[j];
        if (!p.alive) continue;
        if (BM.cellOf(p.x) === it.cx && BM.cellOf(p.y) === it.cy) {
          p.gainItem(it.type, this);
          var def = BM.ITEMS[it.type];
          this.fx.text(it.x, it.y - 10, def.label, def.color, 14);
          this.fx.sparkle(it.x, it.y, def.color);
          this.fx.addFlash(0.06, '255,255,255');
          BM.sound.pickup();
          if (this.mode === 'solo') this.score += 50;
          this.items.splice(i, 1);
          break;
        }
      }
    }

    // ---- 爆風ダメージ ----
    this.resolveFlameDamage();

    // ---- 塗り率の集計 ----
    this.map.tickInk(dt);
    this.inkCounts = this.map.inkCounts();
    this.myRatio = this.inkCounts[1] / (this.inkCounts.total || 1);
    this.foeRatio = this.inkCounts[2] / (this.inkCounts.total || 1);

    // ---- 出口：ノルマ塗り率で開く ----
    if (this.door) {
      this.door.t += dt;
      if (!this.door.open && this.mode === 'solo' && this.myRatio >= this.targetRatio) {
        this.door.open = true;
        BM.sound.doorOpen();
        this.fx.shock(BM.centerOf(this.door.cx), BM.centerOf(this.door.cy), 130, 0.8, '150,255,210', 5);
        this.fx.text(BM.centerOf(this.door.cx), BM.centerOf(this.door.cy) - 26, 'ノルマ達成！出口へ', '#8affd0', 16);
        BM.ui.combo('ノルマ達成 — 出口が開いた!');
      }
      if (this.door.open) {
        var pl = this.players[0];
        if (pl && pl.alive && BM.cellOf(pl.x) === this.door.cx && BM.cellOf(pl.y) === this.door.cy) {
          this.onStageClear();
        }
      }
    }

    this.fx.update(dt);
    BM.ui.syncHud(this);
  };

  Game.prototype.findEntity = function (id) {
    var i;
    for (i = 0; i < this.players.length; i++) if (this.players[i].id === id) return this.players[i];
    for (i = 0; i < this.enemies.length; i++) if (this.enemies[i].id === id) return this.enemies[i];
    return null;
  };

  Game.prototype.resolveFlameDamage = function () {
    var i;
    // 敵
    for (i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (!e.alive || e.spawnFade > 0) continue;
      var cx = BM.cellOf(e.x), cy = BM.cellOf(e.y);
      if (this.flameGrid[cy * COLS + cx] > 0) {
        e.hp--;
        e.hurtFlash = 0.25;
        if (e.hp <= 0) {
          e.alive = false;
          this.combo++;
          this.comboTimer = BM.COMBO_WINDOW;
          this.addScore(e.def.score, e.x, e.y);
          // 撃破 = その場にインクが飛び散る。倒すこと自体が塗りに直結する。
          this.splashInk(BM.cellOf(e.x), BM.cellOf(e.y), BM.KILL_SPLASH, 1, e.x, e.y);
          this.fx.enemyPop(e.x, e.y, e.def.color);
          this.fx.addShake(3);
          this.hitStop = Math.max(this.hitStop, 0.05);
          BM.sound.enemyDie();
          if (this.combo >= 2) BM.ui.combo(this.combo + ' KILL COMBO!');
        } else {
          this.fx.sparkle(e.x, e.y, e.def.color);
          BM.sound.blip(true);
        }
      }
    }
    for (i = this.enemies.length - 1; i >= 0; i--) if (!this.enemies[i].alive) this.enemies.splice(i, 1);

    // プレイヤー
    for (i = 0; i < this.players.length; i++) {
      var p = this.players[i];
      if (!p.alive || p.invuln > 0) continue;
      var pcx = BM.cellOf(p.x), pcy = BM.cellOf(p.y);
      var hit = this.flameGrid[pcy * COLS + pcx] > 0;
      if (!hit) {
        // 敵との接触
        for (var j = 0; j < this.enemies.length; j++) {
          var en = this.enemies[j];
          if (!en.alive || en.spawnFade > 0) continue;
          if (Math.abs(en.x - p.x) < TILE * 0.46 && Math.abs(en.y - p.y) < TILE * 0.46) { hit = true; break; }
        }
      }
      if (hit) this.hurtPlayer(p);
    }
  };

  Game.prototype.hurtPlayer = function (p) {
    if (p.shield > 0) {
      p.shield--;
      p.invuln = 1.6;
      p.hitFlash = 0.4;
      this.fx.shock(p.x, p.y, 60, 0.4, '160,240,255', 4);
      this.fx.addShake(6);
      BM.sound.blip(false);
      this.fx.text(p.x, p.y - 20, 'SHIELD!', '#a0f0ff', 15);
      return;
    }
    // やられると自陣が中立に戻る。塗り合いの世界では、これが一番痛い。
    var wiped = this.wipeInk(BM.cellOf(p.x), BM.cellOf(p.y), BM.DEATH_WIPE, p.team);
    if (wiped) this.fx.text(p.x, p.y + 16, '-' + wiped + ' 陣地', '#ff8080', 14);

    p.lives--;
    p.hitFlash = 0.6;
    this.fx.addShake(16);
    this.fx.addFlash(0.4, '255,60,60');
    this.fx.addAberration(4.5);
    this.fx.vignette = 1;
    this.fx.enemyPop(p.x, p.y, p.color);
    this.hitStop = 0.22;
    BM.sound.hurt();

    if (this.mode === 'vs') {
      // 対戦では即敗北にはしない。スタート地点へ戻され、しばらく動けなくなる。
      // 決着は時間切れ時点の塗り率で決まる。
      p.lives = 1;
      p.stun = 2.0;
      p.invuln = 3.6;
      p.x = BM.centerOf(p.spawnCx);
      p.y = BM.centerOf(p.spawnCy);
      p.activeBombs = 0;
      for (var bi = this.bombs.length - 1; bi >= 0; bi--) {
        if (this.bombs[bi].owner === p) { this.bombs.splice(bi, 1); }
      }
      this.fx.text(p.x, p.y - 28, p.name + ' ダウン!', '#ff8080', 17);
      BM.ui.combo(p.name + ' ダウン — 陣地が削れた!');
      return;
    }

    if (p.lives <= 0) {
      p.alive = false;
      this.onGameOver();
    } else {
      // その場で復帰。無敵時間で立て直す
      p.invuln = BM.INVULN_TIME;
      p.x = BM.centerOf(p.spawnCx);
      p.y = BM.centerOf(p.spawnCy);
      // 復帰位置が塞がれないよう、盤上の爆弾はいったん消す
      for (var i = 0; i < this.bombs.length; i++) {
        var b = this.bombs[i];
        if (b.owner) b.owner.activeBombs = Math.max(0, b.owner.activeBombs - 1);
      }
      this.bombs.length = 0;
      p.activeBombs = 0;
      this.fx.text(p.x, p.y - 26, 'あと ' + p.lives, '#ff5470', 16);
    }
  };

  Game.prototype.onTimeUp = function () {
    if (this.mode === 'vs') {
      // 塗り率で決着
      var c = this.map.inkCounts();
      this.finalCounts = c;
      if (c[1] > c[2]) { this.roundWinner = this.players[0]; this.players[0].wins++; }
      else if (c[2] > c[1]) { this.roundWinner = this.players[1]; this.players[1].wins++; }
      else this.roundWinner = null;
      this.state = BM.S_VSROUND;
      this.stateT = 0;
      this.fx.addFlash(0.4, '255,255,255');
      BM.sound.fanfare();
      BM.ui.showRoundResult(this);
      return;
    }
    // 敵が凶暴化。ここからは逃げ切るしかない
    this.enemies.forEach(function (e) { e.enraged = true; });
    var spots = this.map.freeCells(false).filter(function (c) {
      return (Math.abs(c.x - 1) + Math.abs(c.y - 1)) >= 8;
    });
    BM.shuffle(spots);
    for (var i = 0; i < 2 && i < spots.length; i++) {
      var ex = new BM.Enemy(spots[i].x, spots[i].y, 'chaser');
      ex.enraged = true;
      this.enemies.push(ex);
    }
    this.fx.addFlash(0.5, '255,40,40');
    this.fx.addShake(14);
    BM.ui.combo('TIME UP — 敵が暴走!');
    BM.sound.gameOver();
  };

  Game.prototype.onStageClear = function () {
    this.clearRatio = this.myRatio;
    this.bonusTime = Math.floor(this.timeLeft) * 10;
    this.bonusLife = Math.max(0, this.players[0].lives) * 200;
    // ノルマぴったりで抜けるより、塗り切ってから抜けたほうが儲かる
    this.bonusInk = Math.round(this.myRatio * 100) * 30;
    var bonus = this.bonusTime + this.bonusLife + this.bonusInk;
    this.clearBonus = bonus;
    this.score += bonus;
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      BM.store.set('blastrush.best', String(this.bestScore));
    }
    this.state = BM.S_CLEAR;
    this.stateT = 0;
    this.fx.addFlash(0.5, '180,255,220');
    BM.sound.fanfare();
    BM.ui.showStageClear(this);
  };

  Game.prototype.onGameOver = function () {
    this.state = BM.S_OVER;
    this.stateT = 0;
    this.fx.addFlash(0.6, '255,60,60');
    BM.sound.stopMusic();
    BM.sound.gameOver();
    BM.ui.showGameOver(this);
  };

  /* =========================================================
     描画
     ========================================================= */

  Game.prototype.render = function () {
    var g = this.bctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);

    this.drawFloor(g);
    this.fx.drawBelow(g);
    this.drawItems(g);
    this.drawDoor(g);
    this.drawTiles(g);
    this.drawBombs(g);
    this.drawEntities(g);
    this.drawFlames(g);
    this.fx.drawAbove(g);
    this.drawVignette(g);
    this.drawIntro(g);

    // ---- 合成 ----
    var ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#06040c';
    ctx.fillRect(0, 0, W, H);
    var ox = this.fx.offsetX(), oy = this.fx.offsetY();

    var ab = this.fx.aberration;
    if (ab > 0.4) {
      // R と C(=G+B) を別々にずらして重ねると、正しく色ズレになる
      ctx.globalCompositeOperation = 'lighter';
      this.drawChannel(ctx, '#ff0000', ox - ab, oy);
      this.drawChannel(ctx, '#00ffff', ox + ab, oy);
      ctx.globalCompositeOperation = 'source-over';
    } else {
      ctx.drawImage(this.buf, ox, oy);
    }

    if (this.fx.flash > 0.002) {
      ctx.fillStyle = 'rgba(' + this.fx.flashColor + ',' + (this.fx.flash * 0.75).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  };

  /* buf から指定チャンネルだけ取り出して主画面へ転写する */
  Game.prototype.drawChannel = function (ctx, color, x, y) {
    var t = this.tctx;
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, W, H);
    t.drawImage(this.buf, 0, 0);
    t.globalCompositeOperation = 'multiply';
    t.fillStyle = color;
    t.fillRect(0, 0, W, H);
    t.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.tmp, x, y);
  };

  Game.prototype.drawFloor = function (g) {
    var grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#191130');
    grad.addColorStop(1, '#120c22');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        if (this.map.at(x, y) !== BM.T_EMPTY) continue;
        var px = x * TILE, py = y * TILE;
        var alt = (x + y) % 2 === 0;
        g.fillStyle = alt ? 'rgba(255,255,255,.028)' : 'rgba(0,0,0,.12)';
        g.fillRect(px, py, TILE, TILE);
      }
    }
    // ---- インク（陣地） ----
    // 塗りたてのマスは一瞬ふくらんでから収まる。ベタ塗りに見えないよう
    // タイルごとに角丸半径をずらして、にじんだ輪郭にしている。
    g.save();
    for (var ii = 0; ii < this.map.ink.length; ii++) {
      var team = this.map.ink[ii];
      if (!team) continue;
      var ix = ii % COLS, iy = (ii / COLS) | 0;
      if (this.map.tiles[ii] !== BM.T_EMPTY) continue;
      var T = BM.TEAMS[team];
      var d = this.map.decor[ii];
      var age = this.map.inkT[ii];
      var pop = age < 0.22 ? 1 + Math.sin((age / 0.22) * Math.PI) * 0.28 : 1;
      var px2 = ix * TILE + TILE / 2, py2 = iy * TILE + TILE / 2;
      var half = TILE * 0.5 * pop;

      g.fillStyle = hexA(T.deep, 0.55);
      g.beginPath();
      roundRect(g, px2 - half, py2 - half, half * 2, half * 2, 5 + d * 9);
      g.fill();

      g.fillStyle = hexA(T.ink, 0.30);
      g.beginPath();
      roundRect(g, px2 - half + 2, py2 - half + 2, half * 2 - 4, half * 2 - 4, 4 + d * 8);
      g.fill();

      if (age < 0.3) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = (1 - age / 0.3) * 0.5;
        g.fillStyle = T.ink;
        g.beginPath();
        roundRect(g, px2 - half, py2 - half, half * 2, half * 2, 6 + d * 8);
        g.fill();
        g.restore();
      }
    }
    g.restore();

    // 危険地帯のうっすらした赤（爆風が来る場所）
    g.save();
    // インクの上でも読めるよう、塗りに加えて枠でも示す
    for (var i = 0; i < this.danger.length; i++) {
      if (this.danger[i] !== 1) continue;
      var cx = i % COLS, cy = (i / COLS) | 0;
      var pulse = 0.16 + Math.sin(this.bgPhase * 9 + i) * 0.07;
      g.fillStyle = 'rgba(255,60,40,' + Math.max(0, pulse).toFixed(3) + ')';
      g.fillRect(cx * TILE, cy * TILE, TILE, TILE);
      g.strokeStyle = 'rgba(255,110,80,' + (0.32 + Math.sin(this.bgPhase * 9 + i) * 0.18).toFixed(3) + ')';
      g.lineWidth = 2;
      g.strokeRect(cx * TILE + 2.5, cy * TILE + 2.5, TILE - 5, TILE - 5);
    }
    g.restore();

    g.strokeStyle = 'rgba(120,100,180,.07)';
    g.lineWidth = 1;
    g.beginPath();
    for (var gx = 0; gx <= COLS; gx++) { g.moveTo(gx * TILE + .5, 0); g.lineTo(gx * TILE + .5, H); }
    for (var gy = 0; gy <= ROWS; gy++) { g.moveTo(0, gy * TILE + .5); g.lineTo(W, gy * TILE + .5); }
    g.stroke();
  };

  Game.prototype.drawTiles = function (g) {
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        var t = this.map.at(x, y);
        if (t === BM.T_EMPTY) continue;
        var px = x * TILE, py = y * TILE;
        if (t === BM.T_WALL) this.drawWall(g, px, py, x, y);
        else this.drawBlock(g, px, py, x, y);
      }
    }
  };

  Game.prototype.drawWall = function (g, px, py, x, y) {
    var d = this.map.decor[y * COLS + x];
    g.fillStyle = '#3b2e5c';
    g.fillRect(px, py, TILE, TILE);
    var gr = g.createLinearGradient(px, py, px, py + TILE);
    gr.addColorStop(0, 'rgba(255,255,255,.22)');
    gr.addColorStop(0.45, 'rgba(255,255,255,.04)');
    gr.addColorStop(1, 'rgba(0,0,0,.35)');
    g.fillStyle = gr;
    g.fillRect(px, py, TILE, TILE);
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.fillRect(px, py + TILE - 5, TILE, 5);
    g.fillStyle = 'rgba(255,255,255,.10)';
    g.fillRect(px + 3, py + 3, TILE - 6, 3);
    // リベット
    g.fillStyle = 'rgba(255,255,255,' + (0.10 + d * 0.08).toFixed(2) + ')';
    g.beginPath(); g.arc(px + 7, py + 7, 1.8, 0, 6.3); g.fill();
    g.beginPath(); g.arc(px + TILE - 7, py + 7, 1.8, 0, 6.3); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.5)';
    g.lineWidth = 1;
    g.strokeRect(px + .5, py + .5, TILE - 1, TILE - 1);
  };

  Game.prototype.drawBlock = function (g, px, py, x, y) {
    var d = this.map.decor[y * COLS + x];
    var r = 6;
    g.save();
    g.beginPath();
    roundRect(g, px + 2, py + 2, TILE - 4, TILE - 4, r);
    var gr = g.createLinearGradient(px, py, px, py + TILE);
    gr.addColorStop(0, '#8a6bc4');
    gr.addColorStop(0.5, '#6a4d9e');
    gr.addColorStop(1, '#452f6d');
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = 'rgba(20,10,40,.65)';
    g.lineWidth = 2;
    g.stroke();
    // ハイライト
    g.beginPath();
    roundRect(g, px + 6, py + 5, TILE - 12, 6, 3);
    g.fillStyle = 'rgba(255,255,255,.18)';
    g.fill();
    // ひび（控えめに）
    g.strokeStyle = 'rgba(30,15,55,.32)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(px + 11 + d * 9, py + 18);
    g.lineTo(px + 15 + d * 7, py + 25);
    g.lineTo(px + 12 + d * 11, py + 30);
    g.stroke();
    // 木箱っぽい継ぎ目
    g.strokeStyle = 'rgba(255,255,255,.07)';
    g.beginPath();
    g.moveTo(px + 4, py + TILE * 0.55);
    g.lineTo(px + TILE - 4, py + TILE * 0.55);
    g.stroke();
    g.restore();
  };

  Game.prototype.drawItems = function (g) {
    for (var i = 0; i < this.items.length; i++) {
      var it = this.items[i];
      var def = BM.ITEMS[it.type];
      var pop = it.pop > 0 ? (1 - it.pop / 0.35) : 1;
      var bob = Math.sin(it.t * 3.4) * 3;
      var sc = 0.4 + 0.6 * pop;
      g.save();
      g.translate(it.x, it.y + bob);
      g.scale(sc, sc);
      g.globalCompositeOperation = 'lighter';
      var gr = g.createRadialGradient(0, 0, 2, 0, 0, 26);
      gr.addColorStop(0, hexA(def.color, 0.55));
      gr.addColorStop(1, hexA(def.color, 0));
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 0, 26, 0, 6.3); g.fill();
      g.globalCompositeOperation = 'source-over';
      g.beginPath();
      roundRect(g, -13, -13, 26, 26, 7);
      g.fillStyle = 'rgba(18,10,32,.9)';
      g.fill();
      g.strokeStyle = def.color;
      g.lineWidth = 2;
      g.stroke();
      g.font = '15px system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(def.glyph, 0, 1);
      g.restore();
    }
  };

  Game.prototype.drawDoor = function (g) {
    if (!this.door) return;
    var d = this.door;
    var x = BM.centerOf(d.cx), y = BM.centerOf(d.cy);
    g.save();
    g.translate(x, y);
    var open = d.open;
    var spin = d.t * (open ? 3.2 : 1.1);
    g.globalCompositeOperation = 'lighter';
    var gr = g.createRadialGradient(0, 0, 2, 0, 0, open ? 30 : 18);
    gr.addColorStop(0, open ? 'rgba(150,255,220,.95)' : 'rgba(120,200,180,.5)');
    gr.addColorStop(1, 'rgba(60,220,180,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(0, 0, open ? 30 : 18, 0, 6.3); g.fill();
    g.strokeStyle = open ? 'rgba(160,255,220,.9)' : 'rgba(140,220,190,.4)';
    g.lineWidth = 2.5;
    for (var i = 0; i < 3; i++) {
      var r = 6 + i * 5 + (open ? Math.sin(d.t * 4 + i) * 2 : 0);
      g.beginPath();
      g.arc(0, 0, r, spin + i * 2, spin + i * 2 + 4.2);
      g.stroke();
    }
    // 閉じている間は「ノルマまでどれくらいか」をリングで見せる
    if (!open && this.targetRatio > 0) {
      var prog = BM.clamp(this.myRatio / this.targetRatio, 0, 1);
      g.globalCompositeOperation = 'source-over';
      g.strokeStyle = 'rgba(255,255,255,.14)';
      g.lineWidth = 3.5;
      g.beginPath(); g.arc(0, 0, 16, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(140,255,210,.95)';
      g.lineWidth = 3.5;
      g.beginPath();
      g.arc(0, 0, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog);
      g.stroke();
    }
    g.restore();
  };

  Game.prototype.drawBombs = function (g) {
    for (var i = 0; i < this.bombs.length; i++) {
      var b = this.bombs[i];
      var ratio = b.remote ? 0.5 : BM.clamp(1 - b.fuse / BM.BOMB_FUSE, 0, 1);
      var beat = 1 + Math.sin(b.t * (7 + ratio * 22)) * (0.06 + ratio * 0.11);
      var r = TILE * 0.34 * beat;
      g.save();
      g.translate(b.x, b.y);

      // 影
      g.fillStyle = 'rgba(0,0,0,.45)';
      g.beginPath();
      g.ellipse(0, r * 0.85, r * 0.95, r * 0.35, 0, 0, 6.3);
      g.fill();

      // 本体
      var gr = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
      var hot = ratio > 0.75 && Math.sin(b.t * 34) > 0;
      gr.addColorStop(0, hot ? '#ff8a6a' : '#5b5470');
      gr.addColorStop(0.45, hot ? '#7a2a20' : '#241f33');
      gr.addColorStop(1, '#0d0a16');
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 0, r, 0, 6.3); g.fill();

      if (b.pierce) {
        g.strokeStyle = 'rgba(255,92,224,.85)';
        g.lineWidth = 2;
        g.beginPath(); g.arc(0, 0, r * 0.82, 0, 6.3); g.stroke();
      }
      if (b.remote) {
        g.strokeStyle = 'rgba(90,210,255,.85)';
        g.lineWidth = 2;
        g.setLineDash([4, 4]);
        g.beginPath(); g.arc(0, 0, r * 0.9, b.t * 3, b.t * 3 + 5); g.stroke();
        g.setLineDash([]);
      }

      // 導火線と火花
      g.strokeStyle = '#c9b28a';
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(r * 0.3, -r * 0.75);
      g.quadraticCurveTo(r * 0.85, -r * 1.25, r * 0.5, -r * 1.6);
      g.stroke();
      var sx = r * 0.5, sy = -r * 1.6;
      g.globalCompositeOperation = 'lighter';
      var sg = g.createRadialGradient(sx, sy, 0, sx, sy, 9);
      sg.addColorStop(0, 'rgba(255,255,220,.95)');
      sg.addColorStop(0.4, 'rgba(255,190,60,.7)');
      sg.addColorStop(1, 'rgba(255,120,20,0)');
      g.fillStyle = sg;
      g.beginPath(); g.arc(sx, sy, 9 + Math.sin(b.t * 30) * 2, 0, 6.3); g.fill();
      g.restore();

      if (Math.random() < 0.35) {
        this.fx.spawn(1, {
          x: b.x + r * 0.5, y: b.y - r * 1.6, jitter: 1.5,
          speedMin: 10, speedMax: 45, rMin: 0.8, rMax: 1.8,
          lifeMin: 0.15, lifeMax: 0.35, drag: 2, gravity: -70,
          colors: ['#fff3b0', '#ffb03a']
        });
      }
    }
  };

  Game.prototype.drawFlames = function (g) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (var i = 0; i < this.flames.length; i++) {
      var f = this.flames[i];
      if (f.t < 0) continue;
      var k = f.t / f.life;
      // 立ち上がりは一気に、消えるときはスッと
      var scale = k < 0.16 ? (k / 0.16) : (1 - Math.pow((k - 0.16) / 0.84, 1.7) * 0.85);
      var a = k < 0.16 ? 1 : (1 - Math.pow((k - 0.16) / 0.84, 2));
      var x = BM.centerOf(f.cx), y = BM.centerOf(f.cy);
      var half = TILE * 0.5 * BM.clamp(scale, 0, 1);

      var gr = g.createRadialGradient(x, y, 0, x, y, half * 1.5);
      gr.addColorStop(0, 'rgba(255,255,240,' + (a * 0.95).toFixed(3) + ')');
      gr.addColorStop(0.35, 'rgba(255,214,90,' + (a * 0.8).toFixed(3) + ')');
      gr.addColorStop(0.7, 'rgba(255,110,40,' + (a * 0.5).toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(255,40,10,0)');
      g.fillStyle = gr;
      g.beginPath();
      roundRect(g, x - half, y - half, half * 2, half * 2, half * 0.45);
      g.fill();

      // 白いコア
      g.fillStyle = 'rgba(255,255,255,' + (a * a * 0.85).toFixed(3) + ')';
      g.beginPath();
      var cr = half * 0.42;
      roundRect(g, x - cr, y - cr, cr * 2, cr * 2, cr * 0.5);
      g.fill();
    }
    g.restore();
  };

  Game.prototype.drawEntities = function (g) {
    var list = [];
    var i;
    for (i = 0; i < this.enemies.length; i++) list.push(this.enemies[i]);
    for (i = 0; i < this.players.length; i++) list.push(this.players[i]);
    list.sort(function (a, b) { return a.y - b.y; });
    for (i = 0; i < list.length; i++) {
      if (list[i].kind === 'player') this.drawPlayer(g, list[i]);
      else this.drawEnemy(g, list[i]);
    }
  };

  Game.prototype.drawPlayer = function (g, p) {
    if (!p.alive) return;
    var blink = p.invuln > 0 && Math.floor(p.invuln * 14) % 2 === 0;

    // 残像
    for (var i = 0; i < p.trail.length; i++) {
      var tr = p.trail[i];
      var a = (1 - tr.t / 0.24) * 0.22;
      g.save();
      g.globalAlpha = a;
      g.fillStyle = p.color;
      g.beginPath(); g.arc(tr.x, tr.y, TILE * 0.3, 0, 6.3); g.fill();
      g.restore();
    }
    if (blink) return;

    var bob = Math.sin(p.walkT) * 2.2;
    var sq = 1 + p.squash * 0.22;
    g.save();
    g.translate(p.x, p.y + bob);

    if (p.stun > 0) {
      // 復帰待ち：ぐるぐる回るインクの輪
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = hexA(BM.TEAMS[p.team].ink, 0.8);
      g.lineWidth = 2.5;
      for (var si = 0; si < 3; si++) {
        g.beginPath();
        g.arc(0, -8, 16 + si * 3, p.walkT + si * 2, p.walkT + si * 2 + 1.6);
        g.stroke();
      }
      g.restore();
    }

    // 影
    g.fillStyle = 'rgba(0,0,0,.42)';
    g.beginPath(); g.ellipse(0, TILE * 0.3 - bob, TILE * 0.28, TILE * 0.1, 0, 0, 6.3); g.fill();

    if (p.shield > 0) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = 'rgba(160,240,255,' + (0.35 + Math.sin(p.walkT * 2 + 1) * 0.15).toFixed(2) + ')';
      g.lineWidth = 2.5;
      g.beginPath(); g.arc(0, -2, TILE * 0.42, 0, 6.3); g.stroke();
      g.restore();
    }

    g.scale(1 / sq, sq);

    // 足
    g.fillStyle = p.color2;
    var legSwing = Math.sin(p.walkT) * 4;
    g.beginPath(); roundRect(g, -9, 8, 7, 9 + legSwing * 0.3, 3); g.fill();
    g.beginPath(); roundRect(g, 2, 8, 7, 9 - legSwing * 0.3, 3); g.fill();

    // 胴体
    var gr = g.createLinearGradient(0, -16, 0, 14);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(1, '#c8d4e6');
    g.fillStyle = gr;
    g.beginPath(); roundRect(g, -12, -8, 24, 20, 8); g.fill();
    g.strokeStyle = 'rgba(20,15,40,.55)'; g.lineWidth = 1.6; g.stroke();

    // ヘルメット
    var hg = g.createLinearGradient(0, -22, 0, 0);
    hg.addColorStop(0, p.color);
    hg.addColorStop(1, p.color2);
    g.fillStyle = hg;
    g.beginPath();
    g.arc(0, -8, 13, Math.PI, 0);
    g.lineTo(13, -3); g.lineTo(-13, -3); g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(20,15,40,.55)'; g.stroke();

    // バイザー（向きで少しずれる）
    var vx = p.dir === 'left' ? -3 : (p.dir === 'right' ? 3 : 0);
    var vy = p.dir === 'up' ? -2 : 0;
    g.fillStyle = 'rgba(15,10,30,.9)';
    g.beginPath(); roundRect(g, -9 + vx, -12 + vy, 18, 8, 4); g.fill();
    if (p.dir !== 'up') {
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.beginPath(); g.arc(-4 + vx, -9 + vy, 1.9, 0, 6.3); g.fill();
      g.beginPath(); g.arc(3 + vx, -9 + vy, 1.9, 0, 6.3); g.fill();
    }
    // アンテナ
    g.strokeStyle = p.color; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -20); g.lineTo(0, -26); g.stroke();
    g.fillStyle = '#ffd23d';
    g.beginPath(); g.arc(0, -27, 2.6, 0, 6.3); g.fill();

    if (p.hitFlash > 0) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = p.hitFlash;
      g.fillStyle = '#ff4444';
      g.beginPath(); g.arc(0, -4, 22, 0, 6.3); g.fill();
    }
    g.restore();
  };

  Game.prototype.drawEnemy = function (g, e) {
    if (!e.alive) return;
    var d = e.def;
    var appear = e.spawnFade > 0 ? (1 - e.spawnFade / 0.45) : 1;
    var bob = Math.sin(e.bob) * 2.4;
    var sq = 1 + Math.sin(e.bob * 2) * 0.07;
    g.save();
    g.translate(e.x, e.y + bob);
    g.globalAlpha = (d.phase ? 0.72 : 1) * BM.clamp(appear, 0, 1);
    g.scale(BM.clamp(appear, 0.2, 1) / sq, BM.clamp(appear, 0.2, 1) * sq);

    g.fillStyle = 'rgba(0,0,0,.4)';
    g.beginPath(); g.ellipse(0, 15 - bob, 12, 4.5, 0, 0, 6.3); g.fill();

    if (e.enraged) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      var ag = g.createRadialGradient(0, 0, 4, 0, 0, 24);
      ag.addColorStop(0, 'rgba(255,60,40,.5)');
      ag.addColorStop(1, 'rgba(255,60,40,0)');
      g.fillStyle = ag;
      g.beginPath(); g.arc(0, 0, 24, 0, 6.3); g.fill();
      g.restore();
    }

    var gr = g.createRadialGradient(-4, -6, 2, 0, 2, 16);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.35, d.color);
    gr.addColorStop(1, d.dark);
    g.fillStyle = e.hurtFlash > 0 ? '#ffffff' : gr;
    g.beginPath();
    // ぷにっとした胴体
    g.moveTo(-13, 6);
    g.quadraticCurveTo(-15, -14, 0, -14);
    g.quadraticCurveTo(15, -14, 13, 6);
    g.quadraticCurveTo(13, 15, 0, 15);
    g.quadraticCurveTo(-13, 15, -13, 6);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(15,8,30,.6)'; g.lineWidth = 1.6; g.stroke();

    // 目
    var lookX = e.target ? BM.clamp((BM.centerOf(e.target.x) - e.x) * 0.06, -2.5, 2.5) : 0;
    g.fillStyle = '#ffffff';
    g.beginPath(); g.ellipse(-5, -3, 4.2, 5, 0, 0, 6.3); g.fill();
    g.beginPath(); g.ellipse(5, -3, 4.2, 5, 0, 0, 6.3); g.fill();
    g.fillStyle = '#14102a';
    g.beginPath(); g.arc(-5 + lookX, -2.5, 2.1, 0, 6.3); g.fill();
    g.beginPath(); g.arc(5 + lookX, -2.5, 2.1, 0, 6.3); g.fill();

    if (e.type === 'bomber') {
      g.fillStyle = '#3a2a12';
      g.beginPath(); roundRect(g, -12, -16, 24, 5, 2); g.fill();
      g.beginPath(); roundRect(g, -7, -22, 14, 8, 3); g.fill();
    }
    if (e.hp > 1) {
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.font = '700 9px system-ui';
      g.textAlign = 'center';
      g.fillText('×' + e.hp, 0, 24);
    }
    g.restore();
  };

  Game.prototype.drawVignette = function (g) {
    var v = 0.35 + this.fx.vignette * 0.5;
    var gr = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(' + (this.fx.vignette > 0.05 ? '60,0,0' : '0,0,0') + ',' + v.toFixed(2) + ')');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  };

  Game.prototype.drawIntro = function (g) {
    if (this.introT <= 0) return;
    var k = 1 - this.introT / 1.6;
    var a = k < 0.15 ? k / 0.15 : (k > 0.75 ? (1 - (k - 0.75) / 0.25) : 1);
    var label = this.mode === 'vs'
      ? 'ROUND ' + ((this.players[0] ? this.players[0].wins : 0) + (this.players[1] ? this.players[1].wins : 0) + 1)
      : 'STAGE ' + this.stage;
    g.save();
    g.globalAlpha = BM.clamp(a, 0, 1);
    g.fillStyle = 'rgba(8,4,16,.62)';
    g.fillRect(0, H / 2 - 46, W, 92);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 46px system-ui, sans-serif';
    g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.7)';
    g.strokeText(label, W / 2, H / 2 - 8);
    var gr = g.createLinearGradient(0, H / 2 - 30, 0, H / 2 + 12);
    gr.addColorStop(0, '#fff3c4'); gr.addColorStop(1, '#ff8a2b');
    g.fillStyle = gr;
    g.fillText(label, W / 2, H / 2 - 8);
    g.font = '600 14px system-ui, sans-serif';
    g.fillStyle = 'rgba(230,215,255,.85)';
    g.fillText(
      this.mode === 'vs'
        ? '時間切れの時点で塗り面積が広いほうが勝ち'
        : '爆風で床を塗れ！ ノルマ ' + Math.round(this.targetRatio * 100) + '% で出口が開く',
      W / 2, H / 2 + 26);
    g.restore();
  };

  /* ---------- 小物 ---------- */
  function roundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  BM.Game = Game;
  BM.roundRect = roundRect;
})(BM);
