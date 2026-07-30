/* =========================================================
   DEEP FALL — WebAudio による効果音 / BGM 合成
   外部アセット無し。すべてその場で波形を作る。
   ========================================================= */
(function (BM) {
  'use strict';

  function Sound() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.noise = null;
    this.sfxOn = true;
    this.musicOn = true;
    this._musicTimer = null;
    this._step = 0;
    this._nextNoteTime = 0;
    this._tempo = 138;
    this._patternIndex = 0;
  }

  Sound.prototype.init = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;

    // 全体を軽くコンプレッションして、連鎖爆発でも歪まないように
    var comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.22;

    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.28;
    this.musicGain.connect(this.master);

    // ホワイトノイズのバッファを一度だけ作る
    var len = this.ctx.sampleRate * 2;
    var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
  };

  Sound.prototype._now = function () { return this.ctx.currentTime; };

  /* ---------- 低レベルの部品 ---------- */

  Sound.prototype._tone = function (opt) {
    if (!this.ctx || !this.sfxOn) return;
    var t = opt.at || this._now();
    var osc = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    osc.type = opt.type || 'square';
    osc.frequency.setValueAtTime(opt.f0, t);
    if (opt.f1 != null) {
      if (opt.exp) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opt.f1), t + opt.dur);
      else osc.frequency.linearRampToValueAtTime(opt.f1, t + opt.dur);
    }
    var vol = opt.vol == null ? 0.3 : opt.vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (opt.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + opt.dur);
    osc.connect(g);
    g.connect(opt.dest || this.sfxGain);
    osc.start(t);
    osc.stop(t + opt.dur + 0.05);
  };

  Sound.prototype._noiseBurst = function (opt) {
    if (!this.ctx || !this.sfxOn) return;
    var t = opt.at || this._now();
    var src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = opt.rate || 1;

    var filt = this.ctx.createBiquadFilter();
    filt.type = opt.filter || 'lowpass';
    filt.frequency.setValueAtTime(opt.fStart, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(60, opt.fEnd), t + opt.dur);
    filt.Q.value = opt.q || 1;

    var g = this.ctx.createGain();
    var vol = opt.vol == null ? 0.4 : opt.vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (opt.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + opt.dur);

    src.connect(filt); filt.connect(g); g.connect(this.sfxGain);
    src.start(t, Math.random());
    src.stop(t + opt.dur + 0.05);
  };

  /* ---------- 効果音 ---------- */

  /* 爆弾を落とす */
  Sound.prototype.drop = function () {
    if (!this.ctx) return;
    var t = this._now();
    this._tone({ at: t, type: 'square', f0: 720, f1: 220, dur: 0.16, vol: 0.16, exp: true });
    this._noiseBurst({ at: t, fStart: 2600, fEnd: 500, dur: 0.1, vol: 0.1 });
  };

  /* 爆弾切れ */
  Sound.prototype.empty = function () {
    if (!this.ctx) return;
    this._tone({ type: 'square', f0: 200, f1: 150, dur: 0.1, vol: 0.1, exp: true });
  };

  /* もろい岩を砕く */
  Sound.prototype.crack = function () {
    if (!this.ctx) return;
    var t = this._now();
    this._noiseBurst({ at: t, fStart: 4200, fEnd: 400, dur: 0.2, vol: 0.24, q: 1.5 });
    this._tone({ at: t, type: 'triangle', f0: 300, f1: 120, dur: 0.16, vol: 0.16, exp: true });
  };

  /* 壁のボタン */
  Sound.prototype.button = function () {
    if (!this.ctx) return;
    var t = this._now();
    this._tone({ at: t, type: 'square', f0: 880, dur: 0.07, vol: 0.16 });
    this._tone({ at: t + 0.06, type: 'square', f0: 1318, dur: 0.14, vol: 0.16 });
  };

  /* 狭い穴を抜けた */
  Sound.prototype.nice = function () {
    if (!this.ctx) return;
    var t = this._now();
    [1046, 1318, 1568].forEach(function (f, i) {
      this._tone({ at: t + i * 0.04, type: 'triangle', f0: f, dur: 0.12, vol: 0.13 });
    }, this);
  };

  /* シールドで岩を突き破る */
  Sound.prototype.shield = function () {
    if (!this.ctx) return;
    var t = this._now();
    this._tone({ at: t, type: 'sine', f0: 900, f1: 300, dur: 0.3, vol: 0.24, exp: true });
    this._noiseBurst({ at: t, filter: 'highpass', fStart: 800, fEnd: 4000, dur: 0.28, vol: 0.14 });
  };

  /* 地層帯の切り替わり */
  Sound.prototype.zone = function () {
    if (!this.ctx) return;
    var t = this._now();
    [523, 659, 880].forEach(function (f, i) {
      this._tone({ at: t + i * 0.09, type: 'triangle', f0: f, dur: 0.5, vol: 0.14 });
    }, this);
  };

  /* 墜落 */
  Sound.prototype.crash = function () {
    if (!this.ctx) return;
    var t = this._now();
    this._tone({ at: t, type: 'sawtooth', f0: 320, f1: 40, dur: 0.9, vol: 0.4, exp: true });
    this._noiseBurst({ at: t, fStart: 3000, fEnd: 90, dur: 0.8, vol: 0.32 });
    [392, 349, 294, 233].forEach(function (f, i) {
      this._tone({ at: t + 0.3 + i * 0.19, type: 'square', f0: f, dur: 0.3, vol: 0.16 });
    }, this);
  };

  Sound.prototype.explosion = function (power) {
    if (!this.ctx) return;
    var t = this._now();
    var p = BM.clamp(power || 1, 1, 6);
    var dur = 0.42 + p * 0.05;
    // ドン（低域のサブ）
    this._tone({ at: t, type: 'sine', f0: 150 + p * 8, f1: 28, dur: dur, vol: 0.5, exp: true, attack: 0.004 });
    // バシャッ（ノイズ）
    this._noiseBurst({ at: t, fStart: 5200, fEnd: 180, dur: dur * 0.9, vol: 0.42, rate: 1.0 });
    // 破片の高域
    this._noiseBurst({ at: t + 0.02, filter: 'highpass', fStart: 900, fEnd: 4200, dur: 0.22, vol: 0.1 });
  };

  Sound.prototype.chain = function (n) {
    if (!this.ctx) return;
    var t = this._now();
    var f = 380 + Math.min(n, 10) * 85;
    this._tone({ at: t, type: 'triangle', f0: f, f1: f * 2, dur: 0.14, vol: 0.22, exp: true });
  };


  /* 結晶。連続で取るので短く、取るたび少し上がる */
  Sound.prototype.coin = function (n) {
    if (!this.ctx) return;
    var t = this._now();
    var k = Math.min(8, Math.max(1, n || 1));
    var f = 880 * Math.pow(1.0595, (k - 1) * 2);
    this._tone({ at: t, type: 'triangle', f0: f, dur: 0.07, vol: 0.11 });
    this._tone({ at: t + 0.035, type: 'triangle', f0: f * 1.5, dur: 0.09, vol: 0.09 });
  };

  /* ご褒美の間に入った。ここだけは派手にする */
  Sound.prototype.reward = function () {
    if (!this.ctx) return;
    var t = this._now();
    [523, 659, 784, 1046, 1318].forEach(function (f, i) {
      this._tone({ at: t + i * 0.07, type: 'triangle', f0: f, dur: 0.42, vol: 0.15 });
      this._tone({ at: t + i * 0.07, type: 'square', f0: f * 2, dur: 0.16, vol: 0.05 });
    }, this);
    this._tone({ at: t + 0.35, type: 'sine', f0: 130, f1: 65, dur: 0.7, vol: 0.22, exp: true });
    this._noiseBurst({ at: t, filter: 'highpass', fStart: 1200, fEnd: 6000, dur: 0.5, vol: 0.07 });
  };

  Sound.prototype.pickup = function () {
    if (!this.ctx) return;
    var t = this._now();
    var seq = [523.25, 659.25, 783.99, 1046.5];
    for (var i = 0; i < seq.length; i++) {
      this._tone({ at: t + i * 0.045, type: 'square', f0: seq[i], dur: 0.11, vol: 0.14 });
    }
  };







  Sound.prototype.blip = function (hi) {
    if (!this.ctx) return;
    this._tone({ type: 'square', f0: hi ? 880 : 520, dur: 0.06, vol: 0.12 });
  };


  /* ---------- BGM ----------
     16分音符のシーケンサ。ベース + アルペジオ + ドラム。 */

  var SCALE = [0, 3, 5, 7, 10]; // マイナーペンタトニック
  var BASS_PAT = [0, 0, 7, 0, 5, 5, 3, 3];

  Sound.prototype.startMusic = function () {
    if (!this.ctx || !this.musicOn || this._musicTimer) return;
    var self = this;
    this._nextNoteTime = this._now() + 0.08;
    this._step = 0;
    this._musicTimer = setInterval(function () { self._scheduler(); }, 25);
  };

  Sound.prototype.stopMusic = function () {
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
  };

  Sound.prototype.setTempo = function (bpm) { this._tempo = bpm; };

  Sound.prototype._scheduler = function () {
    if (!this.ctx) return;
    var spb = 60 / this._tempo / 4; // 16分音符の長さ
    while (this._nextNoteTime < this._now() + 0.12) {
      this._playStep(this._step, this._nextNoteTime);
      this._nextNoteTime += spb;
      this._step = (this._step + 1) % 32;
    }
  };

  Sound.prototype._midi = function (n) { return 440 * Math.pow(2, (n - 69) / 12); };

  Sound.prototype._musicTone = function (type, freq, at, dur, vol) {
    var osc = this.ctx.createOscillator();
    var g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g); g.connect(this.musicGain);
    osc.start(at); osc.stop(at + dur + 0.03);
  };

  Sound.prototype._musicNoise = function (at, dur, vol, fStart, fEnd) {
    var src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    var f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(fStart, at);
    f.frequency.exponentialRampToValueAtTime(fEnd, at + dur);
    f.Q.value = 1.2;
    var g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f); f.connect(g); g.connect(this.musicGain);
    src.start(at, Math.random()); src.stop(at + dur + 0.02);
  };

  Sound.prototype._playStep = function (step, at) {
    var root = 45; // A2
    // ベース（8分）
    if (step % 2 === 0) {
      var b = BASS_PAT[(step / 2) % 8];
      this._musicTone('triangle', this._midi(root + b), at, 0.16, 0.3);
    }
    // アルペジオ（16分・裏拍で軽く）
    if (step % 2 === 1) {
      var idx = (step * 3) % SCALE.length;
      var oct = (step % 8 < 4) ? 24 : 12;
      this._musicTone('square', this._midi(root + SCALE[idx] + oct), at, 0.09, 0.075);
    }
    // キック
    if (step % 8 === 0 || step % 16 === 11) {
      this._musicTone('sine', 110, at, 0.11, 0.34);
    }
    // ハイハット
    if (step % 2 === 0) this._musicNoise(at, 0.035, 0.05, 7000, 4500);
    // スネア
    if (step % 16 === 8) this._musicNoise(at, 0.11, 0.13, 1900, 700);
  };

  BM.Sound = Sound;
  BM.sound = new Sound();
})(BM);
