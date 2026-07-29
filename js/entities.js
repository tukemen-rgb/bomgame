/* =========================================================
   DEEP FALL — プレイヤー / 爆弾 / 爆風
   ========================================================= */
(function (BM) {
  'use strict';

  var TILE = BM.TILE, L = BM.PLAY_L, R = BM.PLAY_R;
  var nextId = 1;

  /* =========================================================
     Player — 落ち続けることしかできない
     ========================================================= */
  function Player() {
    this.id = nextId++;
    this.x = BM.centerX(7);
    this.y = -TILE * 3;
    this.vx = 0;
    this.vy = 60;
    this.r = BM.PLAYER_R;

    this.bombs = BM.START_BOMBS;
    this.power = BM.BOMB_POWER;
    this.shield = 0;
    this.iframe = 0;       // シールド発動直後の無敵
    this.shieldFlash = 0;  // 発動演出
    this.slow = 0;

    this.alive = true;
    this.dir = 0;          // -1 / 0 / 1
    this.lean = 0;
    this.spin = 0;
    this.throwT = 0;       // ポケットから爆弾を取り出す動作の進行
    this.flail = 0;        // 手足のばたつき
    this.diving = false;
    this.emptyT = 0;       // 空のポケットを探った直後
    this.trail = [];
    this.crackHit = 0;
    this.deepest = 0;
  }

  Player.prototype.termV = function (world) {
    var v = world.vTerm(this.deepest);
    if (this.diving) v *= BM.DIVE_MUL;
    if (this.slow > 0) v *= 0.55;
    return v;
  };

  Player.prototype.update = function (dt, game) {
    if (!this.alive) return;
    var K = BM.input.keys;
    var world = game.world;

    if (this.slow > 0) this.slow -= dt;
    if (this.iframe > 0) this.iframe -= dt;
    if (this.shieldFlash > 0) this.shieldFlash -= dt;
    if (this.throwT > 0) this.throwT = Math.max(0, this.throwT - dt * 2.6);
    if (this.emptyT > 0) this.emptyT -= dt;
    this.flail += dt * (3 + this.vy / 120);

    // ---- 横 ----
    var ix = (K['ArrowRight'] || K['d'] ? 1 : 0) - (K['ArrowLeft'] || K['a'] ? 1 : 0);
    this.dir = ix;
    if (ix !== 0) {
      this.vx += ix * BM.MOVE_ACCEL * dt;
      var max = BM.MOVE_SPEED * (this.slow > 0 ? 0.85 : 1);
      this.vx = BM.clamp(this.vx, -max, max);
    } else {
      var f = BM.MOVE_FRICTION * dt;
      this.vx = Math.abs(this.vx) <= f ? 0 : this.vx - Math.sign(this.vx) * f;
    }
    this.lean = BM.damp(this.lean, this.vx / BM.MOVE_SPEED, 9, dt);

    // ---- 縦 ----
    this.diving = !!(K['ArrowDown'] || K['s']);
    var vt = this.termV(world);
    if (this.vy < vt) this.vy = Math.min(vt, this.vy + BM.GRAVITY * dt * (this.diving ? 1.6 : 1));
    else this.vy = Math.max(vt, this.vy - BM.GRAVITY * 0.8 * dt);

    // 速いときに一気に動かすとタイルを飛び越えてしまうので、小刻みに進める
    var remainX = this.vx * dt, remainY = this.vy * dt;
    var steps = Math.max(1, Math.ceil(Math.max(Math.abs(remainX), Math.abs(remainY)) / 8));
    for (var s = 0; s < steps && this.alive; s++) {
      this.x = BM.clamp(this.x + remainX / steps,
                        (L) * TILE + this.r, (R + 1) * TILE - this.r);
      this.y += remainY / steps;
      this.resolve(game);
    }

    this.spin += dt * (2 + Math.abs(this.vx) / 90);
    this.deepest = Math.max(this.deepest, Math.floor(this.y / TILE));

    this.trail.push({ x: this.x, y: this.y, t: 0 });
    if (this.trail.length > 14) this.trail.shift();
    for (var i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].t += dt;
      if (this.trail[i].t > 0.28) this.trail.splice(i, 1);
    }

    if (BM.input.pressed(' ') || BM.input.pressed('Enter')) game.dropBomb(this);
  };

  /* 今いる位置がタイルと重なっているかを見る。
     もろい岩なら砕いて通す。岩なら終わり。 */
  Player.prototype.resolve = function (game) {
    var world = game.world;
    var c0 = BM.colOf(this.x - this.r + 1), c1 = BM.colOf(this.x + this.r - 1);
    var r0 = BM.rowOf(this.y - this.r + 1), r1 = BM.rowOf(this.y + this.r - 1);

    for (var row = r0; row <= r1; row++) {
      for (var col = c0; col <= c1; col++) {
        var t = world.tileAt(col, row);
        if (t === BM.T_EMPTY) continue;

        if (t === BM.T_CRACK) {
          game.smash(col, row);
          this.vy = Math.max(120, this.vy * BM.CRACK_COST);
          this.crackHit = 0.25;
          continue;
        }
        // 岩に触れた
        if (this.iframe > 0) {
          // 発動直後は、同じ層の残りをシールドを減らさずに突き破る
          game.smash(col, row);
          continue;
        }
        if (this.shield > 0) {
          this.shield--;
          this.iframe = BM.SHIELD_IFRAME;
          this.shieldFlash = 0.6;
          game.shieldBreak(this, col, row);
          this.vy = Math.max(180, this.vy * 0.6);
          continue;
        }
        game.crash(this, col, row);
        return;
      }
    }
  };

  /* =========================================================
     Bomb — 落として、地層に当たったところで爆ぜる
     ========================================================= */
  function Bomb(x, y, power, fromButton) {
    this.id = nextId++;
    this.x = x;
    this.y = y;
    // 見た目だけポーチの位置から出す。掘る列がずれると理不尽になるので、
    // 判定用の x は常に真下のまま。描画時にこのオフセットを足して戻していく。
    this.vdx = 0;
    this.vy = BM.BOMB_FALL_V;
    this.power = power;
    this.t = 0;
    this.dead = false;
    this.fromButton = fromButton || false;
    this.chain = false;
  }

  Bomb.prototype.update = function (dt, game) {
    this.t += dt;
    if (this.vdx !== 0) this.vdx = BM.damp(this.vdx, 0, 14, dt);
    var steps = Math.max(1, Math.ceil(this.vy * dt / 10));
    for (var s = 0; s < steps; s++) {
      this.y += this.vy * dt / steps;
      var col = BM.colOf(this.x), row = BM.rowOf(this.y + 10);
      var t = game.world.tileAt(col, row);
      if (t !== BM.T_EMPTY) { game.explode(this, col, row); this.dead = true; return; }
    }
    if (this.y > game.player.y + BM.VIEW_H * 1.6) this.dead = true;
  };

  BM.Player = Player;
  BM.Bomb = Bomb;
})(BM);
