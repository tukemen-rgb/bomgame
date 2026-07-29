/* =========================================================
   DEEP FALL — 本体（ロジック + 描画）
   ========================================================= */
(function (BM) {
  'use strict';

  var TILE = BM.TILE, COLS = BM.COLS, L = BM.PLAY_L, R = BM.PLAY_R;
  var W = BM.VIEW_W, H = BM.VIEW_H;

  function Game(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.buf = document.createElement('canvas');
    this.buf.width = W; this.buf.height = H;
    this.bctx = this.buf.getContext('2d');
    this.tmp = document.createElement('canvas');
    this.tmp.width = W; this.tmp.height = H;
    this.tctx = this.tmp.getContext('2d');

    this.fx = BM.fx = new BM.FX();
    this.world = new BM.World();
    this.player = new BM.Player();

    this.state = BM.S_TITLE;
    this.bombs = [];
    this.flames = [];
    this.pending = [];
    this.camY = 0;
    this.score = 0;
    this.chain = 0;
    this.chainT = 0;
    this.hitStop = 0;
    this.stateT = 0;
    this.zoneIndex = 0;
    this.bestDepth = Number(BM.store.get('deepfall.best', 0)) || 0;
    this.bestScore = Number(BM.store.get('deepfall.bestScore', 0)) || 0;
    this.bgDust = [];
    for (var i = 0; i < 46; i++) {
      this.bgDust.push({ x: Math.random() * W, y: Math.random() * H, r: BM.rand(0.6, 2.2), s: BM.rand(0.15, 0.7) });
    }
    this.world.ensure(60);
  }

  /* =========================================================
     進行
     ========================================================= */

  Game.prototype.newRun = function () {
    this.world.reset();
    this.player = new BM.Player();
    this.bombs.length = 0;
    this.flames.length = 0;
    this.pending.length = 0;
    this.fx.clear();
    this.score = 0;
    this.chain = 0; this.chainT = 0;
    this.hitStop = 0;
    this.zoneIndex = 0;
    this.camY = this.player.y - H * 0.34;
    this.world.ensure(BM.rowOf(this.camY) + BM.VIEW_ROWS + 24);
    this.state = BM.S_PLAY;
    this.stateT = 0;
  };

  Game.prototype.update = function (dt) {
    if (this.state !== BM.S_PLAY) {
      this.stateT += dt;
      this.fx.update(dt);
      return;
    }
    if (this.hitStop > 0) { this.hitStop -= dt; dt *= 0.2; }
    this.stateT += dt;
    if (this.chainT > 0) { this.chainT -= dt; if (this.chainT <= 0) this.chain = 0; }

    var p = this.player;
    this.world.ensure(BM.rowOf(p.y) + BM.VIEW_ROWS + 20);
    this.world.update(dt);

    p.update(dt, this);
    if (p.crackHit > 0) p.crackHit -= dt;

    // ---- 爆弾 ----
    var i;
    for (i = this.bombs.length - 1; i >= 0; i--) {
      this.bombs[i].update(dt, this);
      if (this.bombs[i].dead) this.bombs.splice(i, 1);
    }
    for (i = this.pending.length - 1; i >= 0; i--) {
      this.pending[i].t -= dt;
      if (this.pending[i].t <= 0) {
        var q = this.pending.splice(i, 1)[0];
        this.blast(q.col, q.row, q.power, true);
      }
    }
    for (i = this.flames.length - 1; i >= 0; i--) {
      this.flames[i].t += dt;
      if (this.flames[i].t >= this.flames[i].life) this.flames.splice(i, 1);
    }

    if (p.alive) {
      this.checkButtons();
      this.checkItems();
      this.checkPassed();
    }

    // ---- カメラ：常に下へ。戻ることはない ----
    var target = p.y - H * 0.34 + BM.clamp(p.vy * 0.10, 0, 90);
    this.camY = Math.max(this.camY, BM.damp(this.camY, target, 9, dt));
    this.world.prune(BM.rowOf(this.camY));

    // ---- 地層帯の切り替わり ----
    var zi = Math.min(BM.ZONES.length - 1, Math.floor(p.deepest / BM.ZONE_ROWS));
    if (zi !== this.zoneIndex) {
      this.zoneIndex = zi;
      BM.ui.banner(BM.ZONES[zi].name + ' ' + (zi * BM.ZONE_ROWS) + 'm');
      this.fx.addFlash(0.2, '255,255,255');
      BM.sound.zone();
    }

    this.score = Math.max(this.score, p.deepest * 10);
    this.fx.update(dt);
    BM.ui.syncHud(this);
  };

  /* =========================================================
     爆弾と破壊
     ========================================================= */

  Game.prototype.dropBomb = function (p) {
    if (p.bombs <= 0) { BM.sound.empty(); return false; }
    p.bombs--;
    p.nozzle = 1;
    this.bombs.push(new BM.Bomb(p.x, p.y + 14, p.power, false));
    BM.sound.drop();
    this.fx.sparkle(p.x, p.y + 16, '#ffd23d');
    return true;
  };

  Game.prototype.explode = function (bomb, col, row) {
    this.blast(BM.colOf(bomb.x), row, bomb.power, bomb.fromButton);
  };

  /* 十字に掘る。壁は壊れない。埋まった爆弾は誘爆する。 */
  Game.prototype.blast = function (col, row, power, quiet) {
    var dug = 0, chained = 0;
    var self = this;

    function hit(c, r) {
      if (c < L || c > R) return 'wall';
      var t = self.world.tileAt(c, r);
      self.flames.push({ col: c, row: r, t: 0, life: BM.FLAME_LIFE });
      if (t === BM.T_BOMB) {
        self.world.setTile(c, r, BM.T_EMPTY);
        self.pending.push({ col: c, row: r, power: power + 1, t: BM.CHAIN_DELAY });
        chained++;
        return 'bomb';
      }
      if (t !== BM.T_EMPTY) {
        self.world.setTile(c, r, BM.T_EMPTY);
        self.rubble(c, r);
        dug++;
      }
      return 'ok';
    }

    hit(col, row);
    for (var d = 0; d < 4; d++) {
      for (var i = 1; i <= power; i++) {
        var c = col + BM.DIRS[d].x * i, r = row + BM.DIRS[d].y * i;
        if (hit(c, r) === 'wall') break;
      }
    }

    var px = BM.centerX(col), py = BM.centerY(row);
    this.fx.explosionBurst(px, py, power);
    this.fx.addShake(5 + power);
    this.fx.addFlash(0.12, '255,190,120');
    this.fx.addAberration(1.6);
    this.hitStop = Math.max(this.hitStop, 0.04);
    BM.sound.explosion(power);

    if (chained) {
      this.chain++;
      this.chainT = 1.0;
      var bonus = 300 * this.chain * chained;
      this.score += bonus;
      this.fx.text(px, py - 18, '誘爆 +' + bonus, '#ffd23d', 17);
      if (this.chain >= 2) BM.ui.banner(this.chain + ' 連鎖!!');
      BM.sound.chain(this.chain);
    } else if (dug && !quiet) {
      this.score += dug * 15;
    }
    return dug;
  };

  Game.prototype.rubble = function (col, row) {
    var z = BM.ZONES[this.zoneIndex];
    this.fx.blockShatter(BM.centerX(col), BM.centerY(row), [z.rock, z.rockDeep, z.accent, '#ffffff']);
  };

  Game.prototype.smash = function (col, row) {
    this.world.setTile(col, row, BM.T_EMPTY);
    this.rubble(col, row);
    this.fx.addShake(4);
    this.fx.addFlash(0.06, '255,255,255');
    this.hitStop = Math.max(this.hitStop, 0.03);
    this.score += 30;
    BM.sound.crack();
  };

  Game.prototype.shieldBreak = function (p, col, row) {
    this.blast(col, row, 2, true);
    this.fx.shock(p.x, p.y, 80, 0.5, '140,232,255', 5);
    this.fx.text(p.x, p.y - 26, 'シールド!', '#8ce8ff', 17);
    this.fx.addShake(10);
    BM.sound.shield();
  };

  Game.prototype.crash = function (p, col, row) {
    p.alive = false;
    this.crashCell = { col: col, row: row };
    this.fx.addShake(22);
    this.fx.addFlash(0.55, '255,70,50');
    this.fx.addAberration(5);
    this.fx.vignette = 1;
    this.fx.explosionBurst(p.x, p.y, 4);
    this.fx.spawn(26, {
      x: p.x, y: p.y, jitter: 6, speedMin: 60, speedMax: 260,
      rMin: 2, rMax: 5, lifeMin: 0.3, lifeMax: 0.8, drag: 2.4, gravity: 420,
      colors: ['#e8ecf6', '#b9c2d6', '#ff7a3c'], glow: false
    });
    this.hitStop = 0.3;
    BM.sound.crash();
    this.gameOver();
  };

  Game.prototype.gameOver = function () {
    this.state = BM.S_OVER;
    this.stateT = 0;
    var d = this.player.deepest;
    this.score += this.player.bombs * 100;
    this.newBestDepth = d > this.bestDepth;
    this.newBestScore = this.score > this.bestScore;
    if (this.newBestDepth) { this.bestDepth = d; BM.store.set('deepfall.best', String(d)); }
    if (this.newBestScore) { this.bestScore = this.score; BM.store.set('deepfall.bestScore', String(this.score)); }
    BM.sound.stopMusic();
    BM.ui.showGameOver(this);
  };

  /* =========================================================
     ボタン / アイテム / 通過判定
     ========================================================= */

  Game.prototype.buttonPos = function (b) {
    // 壁の内側の面に貼り付いている
    var x = b.side < 0 ? L * TILE + 8 : (R + 1) * TILE - 8;
    return { x: x, y: BM.centerY(b.row) };
  };

  Game.prototype.checkButtons = function () {
    var p = this.player;
    for (var i = 0; i < this.world.layers.length; i++) {
      var list = this.world.layers[i].buttons;
      if (!list) continue;
      for (var j = 0; j < list.length; j++) {
        var b = list[j];
        if (b.hit) continue;
        var pos = this.buttonPos(b);
        if (Math.abs(p.x - pos.x) < p.r + 14 && Math.abs(p.y - pos.y) < p.r + 16) {
          b.hit = true;
          b.t = 0;
          // 押した瞬間に爆弾が落ちる。プレイヤーより速いので必ず先に穴が開く
          this.bombs.push(new BM.Bomb(BM.centerX(b.col), pos.y + 12, p.power + 1, true));
          this.fx.shock(pos.x, pos.y, 70, 0.4, '120,255,180', 4);
          this.fx.text(pos.x, pos.y - 24, 'ON', '#8affd0', 18);
          this.fx.addShake(5);
          this.score += 150;
          BM.sound.button();
        }
      }
    }
  };

  Game.prototype.checkItems = function () {
    var p = this.player;
    for (var i = 0; i < this.world.layers.length; i++) {
      var it = this.world.layers[i].item;
      if (!it || !it.alive) continue;
      var ix = BM.centerX(it.col), iy = BM.centerY(it.row);
      if (Math.abs(p.x - ix) < p.r + 14 && Math.abs(p.y - iy) < p.r + 14) {
        it.alive = false;
        var def = BM.ITEMS[it.type];
        switch (it.type) {
          case 'BOMB':   p.bombs = Math.min(BM.MAX_BOMBS, p.bombs + 1); break;
          case 'POWER':  p.power = Math.min(BM.MAX_POWER, p.power + 1); break;
          case 'SHIELD': p.shield = Math.min(3, p.shield + 1); break;
          case 'SLOW':   p.slow = 3.5; break;
        }
        this.score += 100;
        this.fx.text(ix, iy - 14, def.label, def.color, 15);
        this.fx.sparkle(ix, iy, def.color);
        BM.sound.pickup();
      }
    }
  };

  Game.prototype.checkPassed = function () {
    var p = this.player;
    for (var i = 0; i < this.world.layers.length; i++) {
      var l = this.world.layers[i];
      if (l.passed) continue;
      if (p.y > (l.row + 1) * TILE) {
        l.passed = true;
        this.score += 50;
        // ぎりぎりを抜けたら褒める
        var col = BM.colOf(p.x);
        var narrow = this.gapWidthAround(l, col);
        if (narrow === 1) {
          this.score += 200;
          this.fx.text(p.x, p.y - 30, 'ナイス!', '#8affd0', 17);
          BM.sound.nice();
        }
      }
    }
  };

  Game.prototype.gapWidthAround = function (layer, col) {
    if (!layer.cells) return 9;
    var n = 1, c;
    for (c = col - 1; c >= L && layer.cells[c] === BM.T_EMPTY; c--) n++;
    for (c = col + 1; c <= R && layer.cells[c] === BM.T_EMPTY; c++) n++;
    return n;
  };

  /* =========================================================
     描画
     ========================================================= */

  Game.prototype.render = function () {
    var g = this.bctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    var z = BM.ZONES[this.zoneIndex];

    this.drawBackground(g, z);
    g.save();
    g.translate(0, -this.camY);
    this.fx.drawBelow(g);
    this.drawWalls(g, z);
    this.drawLayers(g, z);
    this.drawItems(g);
    this.drawButtons(g);
    this.drawBombs(g);
    this.drawPlayer(g);
    this.drawFlames(g);
    this.fx.drawAbove(g);
    g.restore();
    this.drawDepthRail(g, z);
    this.drawVignette(g);

    var ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05040a';
    ctx.fillRect(0, 0, W, H);
    var ox = this.fx.offsetX(), oy = this.fx.offsetY();
    var ab = this.fx.aberration;
    if (ab > 0.4) {
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

  Game.prototype.drawBackground = function (g, z) {
    var gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, z.bg1);
    gr.addColorStop(1, z.bg2);
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);

    // 奥の地層（視差）
    g.save();
    g.globalAlpha = 0.5;
    var par = this.camY * 0.35;
    for (var i = -1; i < 14; i++) {
      var y = ((i * 78 - par) % (H + 160) + H + 160) % (H + 160) - 80;
      g.fillStyle = 'rgba(255,255,255,.022)';
      g.fillRect(0, y, W, 34);
      g.fillStyle = 'rgba(0,0,0,.10)';
      g.fillRect(0, y + 34, W, 8);
    }
    g.restore();

    // 上へ流れる塵。落ちている感じはこれが一番効く
    var spd = BM.clamp(this.player.vy, 0, 900);
    for (var d = 0; d < this.bgDust.length; d++) {
      var p = this.bgDust[d];
      p.y -= (30 + spd * p.s) * 0.016;
      if (p.y < -6) { p.y = H + 6; p.x = Math.random() * W; }
      g.fillStyle = 'rgba(255,255,255,' + (0.05 + p.s * 0.08).toFixed(3) + ')';
      g.fillRect(p.x, p.y, p.r, p.r * (1 + spd * 0.012));
    }
  };

  Game.prototype.drawWalls = function (g, z) {
    var top = Math.floor(this.camY / TILE) - 1;
    var bot = top + BM.VIEW_ROWS + 3;
    for (var row = top; row <= bot; row++) {
      this.drawRock(g, L - 1, row, z, true);
      this.drawRock(g, R + 1, row, z, true);
    }
    // 内壁のふち
    g.fillStyle = 'rgba(0,0,0,.4)';
    g.fillRect(L * TILE - 4, top * TILE, 4, (bot - top + 3) * TILE);
    g.fillRect((R + 1) * TILE, top * TILE, 4, (bot - top + 3) * TILE);
  };

  Game.prototype.drawRock = function (g, col, row, z, isWall) {
    var px = col * TILE, py = row * TILE;
    var d = ((col * 31 + row * 57) % 100) / 100;
    g.fillStyle = z.rockDeep;
    g.fillRect(px, py, TILE, TILE);
    var gr = g.createLinearGradient(px, py, px, py + TILE);
    gr.addColorStop(0, z.rock);
    gr.addColorStop(1, z.rockDeep);
    g.fillStyle = gr;
    g.fillRect(px, py, TILE, TILE - 3);
    g.fillStyle = 'rgba(255,255,255,.10)';
    g.fillRect(px, py, TILE, 2.5);
    g.fillStyle = 'rgba(0,0,0,.32)';
    g.fillRect(px, py + TILE - 4, TILE, 4);
    g.fillStyle = 'rgba(255,255,255,' + (0.04 + d * 0.06).toFixed(3) + ')';
    g.beginPath(); g.arc(px + 9 + d * 18, py + 12 + d * 14, 2 + d * 1.6, 0, 6.3); g.fill();
    if (!isWall) {
      g.strokeStyle = 'rgba(0,0,0,.35)';
      g.lineWidth = 1;
      g.strokeRect(px + .5, py + .5, TILE - 1, TILE - 1);
    }
  };

  Game.prototype.drawLayers = function (g, z) {
    var top = Math.floor(this.camY / TILE) - 2;
    var bot = top + BM.VIEW_ROWS + 4;
    for (var i = 0; i < this.world.layers.length; i++) {
      var l = this.world.layers[i];
      if (l.row < top || l.row > bot || !l.cells) continue;
      for (var c = L; c <= R; c++) {
        var t = l.cells[c];
        if (t === BM.T_EMPTY) continue;
        if (t === BM.T_ROCK) this.drawRock(g, c, l.row, z, false);
        else if (t === BM.T_CRACK) this.drawCrack(g, c, l.row, z);
        else if (t === BM.T_BOMB) this.drawBombRock(g, c, l.row, z);
      }
      // 動く地層は縁を光らせて「これは動く」と分かるようにする
      if (l.dynamic) {
        g.strokeStyle = 'rgba(255,220,120,.5)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(L * TILE, l.row * TILE + 1);
        g.lineTo((R + 1) * TILE, l.row * TILE + 1);
        g.stroke();
      }
    }
  };

  Game.prototype.drawCrack = function (g, col, row, z) {
    var px = col * TILE, py = row * TILE;
    var d = ((col * 17 + row * 41) % 100) / 100;
    var gr = g.createLinearGradient(px, py, px, py + TILE);
    gr.addColorStop(0, '#8d7a5e');
    gr.addColorStop(1, '#5a4a33');
    g.fillStyle = gr;
    g.fillRect(px, py, TILE, TILE);
    g.fillStyle = 'rgba(255,240,200,.14)';
    g.fillRect(px, py, TILE, 2.5);
    g.strokeStyle = 'rgba(20,12,6,.75)';
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(px + 4, py + 8 + d * 6);
    g.lineTo(px + 16 + d * 8, py + 20);
    g.lineTo(px + 10, py + 32);
    g.moveTo(px + 20 + d * 6, py + 4);
    g.lineTo(px + 26, py + 18 + d * 8);
    g.lineTo(px + 36, py + 30);
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,.3)';
    g.lineWidth = 1;
    g.strokeRect(px + .5, py + .5, TILE - 1, TILE - 1);
  };

  Game.prototype.drawBombRock = function (g, col, row, z) {
    this.drawRock(g, col, row, z, false);
    var cx = BM.centerX(col), cy = BM.centerY(row);
    var pulse = 0.6 + Math.sin(this.world.t * 6 + col) * 0.4;
    g.save();
    g.globalCompositeOperation = 'lighter';
    var gr = g.createRadialGradient(cx, cy, 1, cx, cy, 20);
    gr.addColorStop(0, 'rgba(255,120,60,' + (0.5 * pulse).toFixed(2) + ')');
    gr.addColorStop(1, 'rgba(255,80,30,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(cx, cy, 20, 0, 6.3); g.fill();
    g.restore();
    g.fillStyle = '#14101f';
    g.beginPath(); g.arc(cx, cy + 1, 10, 0, 6.3); g.fill();
    g.strokeStyle = 'rgba(255,140,70,' + (0.5 + pulse * 0.5).toFixed(2) + ')';
    g.lineWidth = 2;
    g.stroke();
    g.strokeStyle = '#c9b28a'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx + 4, cy - 8); g.quadraticCurveTo(cx + 10, cy - 14, cx + 7, cy - 18); g.stroke();
  };

  Game.prototype.drawButtons = function (g) {
    for (var i = 0; i < this.world.layers.length; i++) {
      var l = this.world.layers[i];
      if (!l.buttons) continue;
      for (var bi = 0; bi < l.buttons.length; bi++) {
      var b = l.buttons[bi], pos = this.buttonPos(b);
      var pulse = 0.5 + Math.sin(this.world.t * 7) * 0.5;

      // 対応する地層まで伸びる導線。押すと何が起きるかを見せる
      g.save();
      g.setLineDash([5, 7]);
      g.lineDashOffset = -this.world.t * 26;
      g.strokeStyle = b.hit ? 'rgba(140,255,200,.55)' : 'rgba(255,120,110,' + (0.22 + pulse * 0.2).toFixed(2) + ')';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(BM.centerX(b.col), pos.y);
      g.lineTo(BM.centerX(b.col), l.row * TILE);
      g.stroke();
      g.restore();

      // 台座
      g.fillStyle = '#241d33';
      g.beginPath();
      BM.roundRect(g, pos.x - 9, pos.y - 13, 18, 26, 5);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1.5; g.stroke();

      // ボタン本体
      var col = b.hit ? '#6bffb0' : '#ff5a4e';
      g.save();
      g.globalCompositeOperation = 'lighter';
      var gr = g.createRadialGradient(pos.x, pos.y, 1, pos.x, pos.y, 22);
      gr.addColorStop(0, hexA(col, b.hit ? 0.6 : (0.35 + pulse * 0.35)));
      gr.addColorStop(1, hexA(col, 0));
      g.fillStyle = gr;
      g.beginPath(); g.arc(pos.x, pos.y, 22, 0, 6.3); g.fill();
      g.restore();
      g.fillStyle = col;
      g.beginPath(); g.arc(pos.x, pos.y, b.hit ? 5.5 : 7, 0, 6.3); g.fill();
      g.fillStyle = 'rgba(255,255,255,.75)';
      g.beginPath(); g.arc(pos.x - 2, pos.y - 2.5, 2, 0, 6.3); g.fill();
      }
    }
  };

  Game.prototype.drawItems = function (g) {
    for (var i = 0; i < this.world.layers.length; i++) {
      var it = this.world.layers[i].item;
      if (!it || !it.alive) continue;
      var def = BM.ITEMS[it.type];
      var x = BM.centerX(it.col), y = BM.centerY(it.row) + Math.sin(this.world.t * 3 + it.col) * 4;
      g.save();
      g.translate(x, y);
      g.globalCompositeOperation = 'lighter';
      var gr = g.createRadialGradient(0, 0, 2, 0, 0, 24);
      gr.addColorStop(0, hexA(def.color, 0.5));
      gr.addColorStop(1, hexA(def.color, 0));
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 0, 24, 0, 6.3); g.fill();
      g.globalCompositeOperation = 'source-over';
      g.beginPath(); BM.roundRect(g, -13, -13, 26, 26, 8); g.fillStyle = 'rgba(16,10,28,.92)'; g.fill();
      g.strokeStyle = def.color; g.lineWidth = 2; g.stroke();
      g.font = '15px system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(def.glyph, 0, 1);
      g.restore();
    }
  };

  Game.prototype.drawBombs = function (g) {
    for (var i = 0; i < this.bombs.length; i++) {
      var b = this.bombs[i];
      g.save();
      g.translate(b.x, b.y);
      // 落下の尾
      var tg = g.createLinearGradient(0, -34, 0, 0);
      tg.addColorStop(0, 'rgba(255,160,60,0)');
      tg.addColorStop(1, 'rgba(255,180,80,.5)');
      g.fillStyle = tg;
      g.beginPath(); BM.roundRect(g, -4, -34, 8, 34, 4); g.fill();

      var r = 11;
      var gr = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
      gr.addColorStop(0, '#5b5470');
      gr.addColorStop(0.45, '#241f33');
      gr.addColorStop(1, '#0d0a16');
      g.fillStyle = gr;
      g.beginPath(); g.arc(0, 0, r, 0, 6.3); g.fill();
      g.strokeStyle = b.fromButton ? 'rgba(120,255,180,.9)' : 'rgba(255,180,80,.8)';
      g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, r - 1, 0, 6.3); g.stroke();
      g.globalCompositeOperation = 'lighter';
      var sg = g.createRadialGradient(0, -r - 4, 0, 0, -r - 4, 9);
      sg.addColorStop(0, 'rgba(255,255,220,.95)');
      sg.addColorStop(1, 'rgba(255,120,20,0)');
      g.fillStyle = sg;
      g.beginPath(); g.arc(0, -r - 4, 9, 0, 6.3); g.fill();
      g.restore();
    }
  };

  Game.prototype.drawFlames = function (g) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (var i = 0; i < this.flames.length; i++) {
      var f = this.flames[i];
      var k = f.t / f.life;
      var scale = k < 0.16 ? (k / 0.16) : (1 - Math.pow((k - 0.16) / 0.84, 1.7) * 0.85);
      var a = k < 0.16 ? 1 : (1 - Math.pow((k - 0.16) / 0.84, 2));
      var x = BM.centerX(f.col), y = BM.centerY(f.row);
      var half = TILE * 0.5 * BM.clamp(scale, 0, 1);
      var gr = g.createRadialGradient(x, y, 0, x, y, half * 1.5);
      gr.addColorStop(0, 'rgba(255,255,240,' + (a * 0.95).toFixed(3) + ')');
      gr.addColorStop(0.35, 'rgba(255,214,90,' + (a * 0.8).toFixed(3) + ')');
      gr.addColorStop(0.7, 'rgba(255,110,40,' + (a * 0.5).toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(255,40,10,0)');
      g.fillStyle = gr;
      g.beginPath(); BM.roundRect(g, x - half, y - half, half * 2, half * 2, half * 0.45); g.fill();
    }
    g.restore();
  };

  Game.prototype.drawPlayer = function (g) {
    var p = this.player;
    if (!p.alive) return;

    // 残像
    for (var i = 0; i < p.trail.length; i++) {
      var tr = p.trail[i];
      var a = (1 - tr.t / 0.28) * 0.22 * BM.clamp(p.vy / 400, 0.3, 1);
      g.save();
      g.globalAlpha = a;
      g.fillStyle = '#8fd6ff';
      g.beginPath(); BM.roundRect(g, tr.x - 9, tr.y - 12, 18, 24, 6); g.fill();
      g.restore();
    }

    // 着地予測線。どこへ落ちるかが常に見えていないと理不尽になる
    var col = BM.colOf(p.x);
    var landRow = -1;
    for (var r = BM.rowOf(p.y) + 1; r < BM.rowOf(p.y) + 26; r++) {
      if (this.world.tileAt(col, r) !== BM.T_EMPTY) { landRow = r; break; }
    }
    if (landRow > 0) {
      g.save();
      g.setLineDash([3, 9]);
      g.lineDashOffset = -this.world.t * 40;
      g.strokeStyle = 'rgba(255,90,70,.5)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(p.x, p.y + 16);
      g.lineTo(p.x, landRow * TILE);
      g.stroke();
      g.restore();
    }

    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.lean * 0.28);
    var stretch = 1 + BM.clamp(p.vy / 1400, 0, 0.3);

    if (p.shield > 0) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = 'rgba(140,232,255,' + (0.4 + Math.sin(p.spin * 3) * 0.2).toFixed(2) + ')';
      g.lineWidth = 2.5;
      g.beginPath(); g.arc(0, 0, 20, 0, 6.3); g.stroke();
      g.restore();
    }

    g.scale(1 / stretch, stretch);

    // 安定翼
    g.fillStyle = '#2c2440';
    g.beginPath();
    g.moveTo(-10, 2); g.lineTo(-16, 12); g.lineTo(-9, 11); g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(10, 2); g.lineTo(16, 12); g.lineTo(9, 11); g.closePath(); g.fill();

    // 胴体（タンク）
    var bg = g.createLinearGradient(0, -15, 0, 14);
    bg.addColorStop(0, '#e8ecf6');
    bg.addColorStop(0.55, '#b9c2d6');
    bg.addColorStop(1, '#6f7894');
    g.fillStyle = bg;
    g.beginPath(); BM.roundRect(g, -10, -14, 20, 27, 7); g.fill();
    g.strokeStyle = 'rgba(18,12,34,.7)'; g.lineWidth = 1.8; g.stroke();

    // 覗き窓
    g.save();
    g.beginPath(); BM.roundRect(g, -6.5, -10, 13, 13, 4); g.clip();
    g.fillStyle = '#140f26'; g.fillRect(-8, -12, 16, 18);
    g.fillStyle = '#2b6f9e';
    g.fillRect(-8, -10 + p.lean * 2, 16, 18);
    g.restore();

    // 単眼レンズ。進行方向＝下を向いている
    var lx = p.lean * 2.2;
    g.fillStyle = '#0e0a1c';
    g.beginPath(); g.arc(lx * 0.5, 6, 6, 0, 6.3); g.fill();
    var lg = g.createRadialGradient(lx - 1, 4.5, 0.5, lx, 6, 4.5);
    lg.addColorStop(0, '#ffffff');
    lg.addColorStop(0.4, '#7fe3ff');
    lg.addColorStop(1, '#1a6f9e');
    g.fillStyle = lg;
    g.beginPath(); g.arc(lx, 6, 4.2, 0, 6.3); g.fill();
    g.fillStyle = 'rgba(255,255,255,.9)';
    g.beginPath(); g.arc(lx - 1.3, 4.6, 1.2, 0, 6.3); g.fill();

    // 射出口（爆弾を落とすと反動で沈む）
    var nz = p.nozzle > 0 ? p.nozzle * 3 : 0;
    g.fillStyle = '#39304f';
    g.beginPath(); BM.roundRect(g, -3.5, 12 - nz, 7, 7, 2.5); g.fill();

    if (p.crackHit > 0) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = p.crackHit * 3;
      g.fillStyle = '#ffd7a0';
      g.beginPath(); g.arc(0, 0, 22, 0, 6.3); g.fill();
    }
    g.restore();
  };

  /* 右端の深度計。今どこまで来たかが常時見える */
  Game.prototype.drawDepthRail = function (g, z) {
    g.save();
    var x = W - 3;
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.fillRect(W - 6, 0, 6, H);
    var top = this.camY, bot = this.camY + H;
    for (var m = Math.floor(top / TILE / 10) * 10; m * TILE < bot; m += 10) {
      var y = m * TILE - this.camY;
      if (y < 0 || y > H) continue;
      var major = m % 50 === 0;
      g.fillStyle = major ? hexA(z.accent, 0.9) : 'rgba(255,255,255,.25)';
      g.fillRect(W - (major ? 12 : 7), y, major ? 12 : 7, major ? 2 : 1);
      if (major) {
        g.font = '700 9px system-ui, sans-serif';
        g.textAlign = 'right';
        g.fillStyle = hexA(z.accent, 0.85);
        g.fillText(m + 'm', W - 15, y + 3);
      }
    }
    g.restore();
    void x;
  };

  Game.prototype.drawVignette = function (g) {
    var v = 0.4 + this.fx.vignette * 0.45;
    var gr = g.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.8);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(' + (this.fx.vignette > 0.05 ? '60,0,0' : '0,0,0') + ',' + v.toFixed(2) + ')');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
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
