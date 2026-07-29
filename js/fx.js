/* =========================================================
   BLAST RUSH — 演出（パーティクル / 画面揺れ / 衝撃波 / 数字）
   「爽快感」はここで作る。
   ========================================================= */
(function (BM) {
  'use strict';

  function FX() {
    this.particles = [];
    this.shocks = [];
    this.texts = [];
    this.shake = 0;
    this.shakeDir = { x: 0, y: 0 };
    this.flash = 0;
    this.flashColor = '255,255,255';
    this.aberration = 0;
    this.vignette = 0;
    this._sx = 0; this._sy = 0;
  }

  FX.prototype.clear = function () {
    this.particles.length = 0;
    this.shocks.length = 0;
    this.texts.length = 0;
    this.shake = 0; this.flash = 0; this.aberration = 0; this.vignette = 0;
  };

  /* ---------- 入力系 ---------- */

  FX.prototype.addShake = function (amount, dx, dy) {
    this.shake = Math.min(26, this.shake + amount);
    if (dx || dy) {
      var l = Math.hypot(dx, dy) || 1;
      this.shakeDir.x = dx / l; this.shakeDir.y = dy / l;
    } else {
      this.shakeDir.x = 0; this.shakeDir.y = 0;
    }
  };

  FX.prototype.addFlash = function (a, color) {
    this.flash = Math.min(1, this.flash + a);
    if (color) this.flashColor = color;
  };

  FX.prototype.addAberration = function (a) {
    // 強すぎると画面が読めなくなるので、上限は小さく・戻りは速く
    this.aberration = Math.min(5, this.aberration + a);
  };

  FX.prototype.shock = function (x, y, maxR, life, color, width) {
    this.shocks.push({
      x: x, y: y, r: 6, maxR: maxR, t: 0, life: life || 0.36,
      color: color || '255,190,90', w: width || 5
    });
  };

  FX.prototype.text = function (x, y, str, color, size, vy) {
    // 連鎖中は同じ場所に何枚も出るので、少しずらして重なりを散らす
    this.texts.push({
      x: x + BM.rand(-9, 9), y: y + BM.rand(-5, 5), s: str, t: 0, life: 0.9,
      color: color || '#ffe14d', size: size || 15, vy: vy == null ? -46 : vy
    });
  };

  FX.prototype.spawn = function (n, opt) {
    for (var i = 0; i < n; i++) {
      var ang = opt.angle != null
        ? opt.angle + BM.rand(-opt.spread, opt.spread)
        : BM.rand(0, Math.PI * 2);
      var sp = BM.rand(opt.speedMin, opt.speedMax);
      this.particles.push({
        x: opt.x + BM.rand(-(opt.jitter || 0), opt.jitter || 0),
        y: opt.y + BM.rand(-(opt.jitter || 0), opt.jitter || 0),
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        g: opt.gravity == null ? 0 : opt.gravity,
        drag: opt.drag == null ? 1.8 : opt.drag,
        r: BM.rand(opt.rMin || 1.5, opt.rMax || 4),
        t: 0,
        life: BM.rand(opt.lifeMin || 0.3, opt.lifeMax || 0.8),
        colors: opt.colors,
        color: BM.pick(opt.colors),
        shape: opt.shape || 'circle',
        rot: BM.rand(0, Math.PI * 2),
        vr: BM.rand(-9, 9),
        glow: opt.glow !== false,
        fade: opt.fade == null ? 1 : opt.fade
      });
    }
  };

  /* ---------- プリセット ---------- */

  FX.prototype.explosionBurst = function (x, y, power) {
    var p = BM.clamp(power, 1, 8);
    this.spawn(16 + p * 3, {
      x: x, y: y, jitter: 6,
      speedMin: 60, speedMax: 240 + p * 22,
      rMin: 2, rMax: 5.5, lifeMin: 0.22, lifeMax: 0.62,
      colors: ['#fff6c8', '#ffd23d', '#ff8a2b', '#ff4d2b'],
      drag: 2.6, gravity: 120
    });
    this.spawn(8, {
      x: x, y: y, jitter: 4,
      speedMin: 20, speedMax: 90,
      rMin: 6, rMax: 13, lifeMin: 0.4, lifeMax: 0.9,
      colors: ['rgba(120,110,130,.55)', 'rgba(80,70,95,.5)', 'rgba(160,150,170,.4)'],
      drag: 3.2, gravity: -40, glow: false
    });
    this.shock(x, y, 44 + p * 12, 0.34, '255,200,110', 5);
  };

  FX.prototype.blockShatter = function (x, y, base) {
    this.spawn(14, {
      x: x, y: y, jitter: 13,
      speedMin: 40, speedMax: 190,
      rMin: 2.5, rMax: 6.5, lifeMin: 0.35, lifeMax: 0.85,
      colors: base || ['#7a5ba8', '#5c4183', '#9a7cc4', '#3d2b5c'],
      drag: 2.2, gravity: 620, shape: 'rect', glow: false
    });
  };

  FX.prototype.enemyPop = function (x, y, color) {
    this.spawn(22, {
      x: x, y: y, jitter: 5,
      speedMin: 50, speedMax: 210,
      rMin: 2, rMax: 5, lifeMin: 0.3, lifeMax: 0.75,
      colors: [color, '#ffffff', '#ffd23d'],
      drag: 2.4, gravity: 260
    });
    this.shock(x, y, 40, 0.3, '255,255,255', 3);
  };

  FX.prototype.sparkle = function (x, y, color) {
    this.spawn(10, {
      x: x, y: y, jitter: 10,
      speedMin: 15, speedMax: 70,
      rMin: 1.2, rMax: 3, lifeMin: 0.4, lifeMax: 0.9,
      colors: [color, '#ffffff'],
      drag: 1.4, gravity: -60
    });
  };

  FX.prototype.dust = function (x, y) {
    this.spawn(3, {
      x: x, y: y, jitter: 4,
      speedMin: 8, speedMax: 40,
      rMin: 1.5, rMax: 3.5, lifeMin: 0.2, lifeMax: 0.45,
      colors: ['rgba(190,175,220,.5)', 'rgba(140,125,175,.4)'],
      drag: 3, gravity: -30, glow: false
    });
  };

  /* ---------- 更新 ---------- */

  FX.prototype.update = function (dt) {
    var i, p;
    for (i = this.particles.length - 1; i >= 0; i--) {
      p = this.particles[i];
      p.t += dt;
      if (p.t >= p.life) { this.particles.splice(i, 1); continue; }
      var d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d;
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    for (i = this.shocks.length - 1; i >= 0; i--) {
      var s = this.shocks[i];
      s.t += dt;
      if (s.t >= s.life) { this.shocks.splice(i, 1); continue; }
      var k = s.t / s.life;
      s.r = 6 + (s.maxR - 6) * (1 - Math.pow(1 - k, 2.6));
    }
    for (i = this.texts.length - 1; i >= 0; i--) {
      var t = this.texts[i];
      t.t += dt;
      if (t.t >= t.life) { this.texts.splice(i, 1); continue; }
      t.y += t.vy * dt;
      t.vy *= Math.exp(-2.4 * dt);
    }

    this.shake = Math.max(0, this.shake - dt * (this.shake * 6 + 12));
    this.flash = Math.max(0, this.flash - dt * 4.2);
    this.aberration = Math.max(0, this.aberration - dt * 42);
    this.vignette = Math.max(0, this.vignette - dt * 1.6);

    if (this.shake > 0.05) {
      var mag = this.shake;
      if (this.shakeDir.x || this.shakeDir.y) {
        this._sx = this.shakeDir.x * mag * BM.rand(0.4, 1) + BM.rand(-mag, mag) * 0.35;
        this._sy = this.shakeDir.y * mag * BM.rand(0.4, 1) + BM.rand(-mag, mag) * 0.35;
      } else {
        this._sx = BM.rand(-mag, mag);
        this._sy = BM.rand(-mag, mag);
      }
    } else { this._sx = 0; this._sy = 0; }
  };

  FX.prototype.offsetX = function () { return this._sx; };
  FX.prototype.offsetY = function () { return this._sy; };

  /* ---------- 描画 ---------- */

  FX.prototype.drawBelow = function (ctx) {
    // 衝撃波リング（加算合成）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < this.shocks.length; i++) {
      var s = this.shocks[i];
      var k = s.t / s.life;
      var a = (1 - k) * (1 - k);
      ctx.strokeStyle = 'rgba(' + s.color + ',' + (a * 0.85).toFixed(3) + ')';
      ctx.lineWidth = s.w * (1 - k * 0.65) + 0.4;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  };

  FX.prototype.drawAbove = function (ctx) {
    var i, p, k, a;
    ctx.save();
    // 発光しないパーティクル（瓦礫・煙）
    for (i = 0; i < this.particles.length; i++) {
      p = this.particles[i];
      if (p.glow) continue;
      k = p.t / p.life;
      a = 1 - k * k;
      ctx.globalAlpha = a * p.fade;
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.r, -p.r, p.r * 2, p.r * 2);
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - k * 0.35), 0, Math.PI * 2); ctx.fill();
      }
    }
    // 発光パーティクル
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < this.particles.length; i++) {
      p = this.particles[i];
      if (!p.glow) continue;
      k = p.t / p.life;
      a = 1 - k * k;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      var r = p.r * (1 - k * 0.5);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = a * 0.28;
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // 浮かぶ数字・テキスト
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (i = 0; i < this.texts.length; i++) {
      var t = this.texts[i];
      k = t.t / t.life;
      var sc = k < 0.15 ? BM.lerp(1.6, 1, k / 0.15) : 1;
      ctx.globalAlpha = k > 0.6 ? (1 - (k - 0.6) / 0.4) : 1;
      ctx.font = '900 ' + (t.size * sc).toFixed(1) + 'px system-ui, sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,.75)';
      ctx.strokeText(t.s, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.s, t.x, t.y);
    }
    ctx.restore();
  };

  BM.FX = FX;
})(BM);
