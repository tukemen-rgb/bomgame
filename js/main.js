/* =========================================================
   DEEP FALL — 入力 / UI / メインループ
   ========================================================= */
(function (BM) {
  'use strict';

  /* ---------- 入力 ---------- */
  var input = {
    keys: {},
    just: {},
    pressed: function (k) { return !!this.just[k]; },
    endFrame: function () { this.just = {}; }
  };
  BM.input = input;

  function normKey(e) { return e.key.length === 1 ? e.key.toLowerCase() : e.key; }
  var HANDLED = { 'ArrowUp': 1, 'ArrowDown': 1, 'ArrowLeft': 1, 'ArrowRight': 1, ' ': 1, 'Enter': 1 };

  window.addEventListener('keydown', function (e) {
    var k = normKey(e);
    if (HANDLED[k]) e.preventDefault();
    if (!input.keys[k]) input.just[k] = true;
    input.keys[k] = true;
    BM.sound.init();
    onKeyDown(k);
  });
  window.addEventListener('keyup', function (e) { input.keys[normKey(e)] = false; });
  window.addEventListener('blur', function () { input.keys = {}; });

  function bindTouch() {
    var btns = document.querySelectorAll('#touch .tbtn');
    Array.prototype.forEach.call(btns, function (b) {
      var k = b.getAttribute('data-key');
      var down = function (ev) {
        ev.preventDefault();
        BM.sound.init();
        if (!input.keys[k]) input.just[k] = true;
        input.keys[k] = true;
        onKeyDown(k);
      };
      var up = function (ev) { ev.preventDefault(); input.keys[k] = false; };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    });
  }

  /* ---------- UI ---------- */
  var el = {};
  var ui = {
    cache: function () {
      el.overlay = document.getElementById('overlay');
      el.panel = document.getElementById('panel');
      el.depth = document.getElementById('hud-depth');
      el.score = document.getElementById('hud-score');
      el.best = document.getElementById('hud-best');
      el.ammo = document.querySelector('.hud-ammo');
      el.pips = document.getElementById('ammo-pips');
      el.ammoCount = document.getElementById('ammo-count');
      el.touchAmmo = document.getElementById('touch-ammo');
      for (var i = 0; i < BM.MAX_BOMBS; i++) {
        var pip = document.createElement('span');
        pip.className = 'pip';
        el.pips.appendChild(pip);
      }
      el.banner = document.getElementById('combo-banner');
    },
    hide: function () { el.overlay.classList.add('hidden'); },
    show: function (html) { el.panel.innerHTML = html; el.overlay.classList.remove('hidden'); },

    banner: function (text) {
      el.banner.textContent = text;
      el.banner.classList.remove('show');
      void el.banner.offsetWidth;
      el.banner.classList.add('show');
    },
    bump: function (node) { node.classList.remove('bump'); void node.offsetWidth; node.classList.add('bump'); },

    _d: -1, _s: -1, _b: -1,
    reset: function () { this._d = -1; this._s = -1; this._b = -1; },

    syncHud: function (g) {
      var p = g.player;
      if (p.deepest !== this._d) {
        el.depth.innerHTML = p.deepest + '<small>m</small>';
        this._d = p.deepest;
      }
      if (g.score !== this._s) {
        el.score.textContent = g.score.toLocaleString('en-US');
        if (g.score > this._s && this._s >= 0) this.bump(el.score);
        this._s = g.score;
      }
      if (p.bombs !== this._b) {
        var pips = el.pips.children;
        for (var i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < p.bombs);
        el.ammoCount.innerHTML = p.bombs + '<i>/' + BM.MAX_BOMBS + '</i>';
        el.ammo.classList.toggle('empty', p.bombs === 0);
        el.ammo.classList.remove('bump'); void el.ammo.offsetWidth; el.ammo.classList.add('bump');
        if (el.touchAmmo) el.touchAmmo.textContent = p.bombs;
        this._b = p.bombs;
      }
      el.best.textContent = g.bestDepth + 'm';
    },

    showTitle: function (g) {
      this.show(
        '<h1>DEEP FALL</h1>' +
        '<div class="sub">落ち続けろ。<b style="color:#ff8a6a">止まった時が終わり。</b></div>' +
        '<div class="menu">' +
        '<button data-act="play">▶ 落ちる</button>' +
        '<button data-act="how">📖 あそびかた</button>' +
        '</div>' +
        '<div class="tips">最高到達 <b>' + g.bestDepth + 'm</b> ／ ハイスコア <b>' +
        g.bestScore.toLocaleString('en-US') + '</b></div>'
      );
    },

    showHow: function () {
      this.show(
        '<h2>あそびかた</h2>' +
        '<div class="tips" style="text-align:left;font-size:12.5px">' +
        '<p><code>←</code> <code>→</code> 横移動 ／ <code>↓</code> 急降下 ／ <code>Space</code> 爆弾を落とす</p>' +
        '<p><b style="color:#ff8a6a">地面に触れた瞬間に終わり。</b>' +
        '止まることは許されていないので、下へ抜ける道を落ちながら作り続ける。<br>' +
        'プレイヤーの真下に伸びる赤い点線が、今のままだとぶつかる場所。</p>' +
        '<p><b>抜け方はいろいろある</b><br>' +
        '・<b>穴</b> … そのまま通す。狭い穴を抜けるとボーナス<br>' +
        '・<b>もろい岩</b>（茶色でひび割れ）… ぶつかれば砕ける。ただし落下が鈍る<br>' +
        '・<b>横に動く穴 / 開閉する穴</b>（上辺が光る層）… 完全には塞がらない。読んで合わせる<br>' +
        '・<b>ボタン</b>（壁の赤いランプ）… 全面岩の層に来たらこれ。落ちながら触れると' +
        '爆弾が落ちて穴が開く。点線が落下地点を教えてくれる<br>' +
        '・<b>埋まった爆弾</b>（オレンジに光る岩）… 自分の爆弾を当てると誘爆して大穴。連鎖ほど高得点<br>' +
        '・<b>自前の爆弾</b> … どの層でも真下に落として掘れる</p>' +
        '<p><b>爆弾は腰のポーチから取り出す。</b>初期3個・最大9個で、拾わない限り増えない。<br>' +
        '画面右上の丸が残数。<b style="color:#ff8a6a">0になると赤く点滅し、押しても空振りする</b>ので、<br>' +
        'どの層で使うかを決めてから落とすこと。💣 のアイテムで1個補充できる。</p>' +
        '<p>100m ごとに地層が変わり、落下速度も層の間隔も上がっていく。</p>' +
        '</div>' +
        '<div class="menu"><button data-act="back">◀ もどる</button></div>'
      );
    },

    showPause: function () {
      this.show(
        '<h2>PAUSE</h2>' +
        '<div class="menu">' +
        '<button data-act="resume">▶ 再開</button>' +
        '<button data-act="title">◀ タイトルへ</button>' +
        '</div>' +
        '<div class="tips">音楽 <code>M</code> ／ 効果音 <code>N</code></div>'
      );
    },

    showGameOver: function (g) {
      this.show(
        '<h2 style="color:#ff6a4e">墜落</h2>' +
        '<div class="rows">' +
        '<div class="stat">到達深度 <b style="color:#ffd23d">' + g.player.deepest + 'm</b>' +
        (g.newBestDepth ? ' <span class="blink">最深記録!</span>' : '') + '</div>' +
        '<div class="stat">SCORE <b>' + g.score.toLocaleString('en-US') + '</b>' +
        (g.newBestScore ? ' <span class="blink">更新!</span>' : '') + '</div>' +
        '<div class="stat">これまでの最深 <b>' + g.bestDepth + 'm</b></div>' +
        '</div>' +
        '<div class="menu">' +
        '<button data-act="play">↻ もう一度</button>' +
        '<button data-act="title">◀ タイトルへ</button>' +
        '</div>' +
        '<div class="blink">Space でもう一度</div>'
      );
    }
  };
  BM.ui = ui;

  /* ---------- 進行 ---------- */
  var game;

  function act(name) {
    BM.sound.init();
    switch (name) {
      case 'play':
        ui.reset();
        game.newRun();
        ui.hide();
        BM.sound.startMusic();
        break;
      case 'resume':
        game.state = BM.S_PLAY;
        ui.hide();
        break;
      case 'title':
        game.state = BM.S_TITLE;
        game.stateT = 0;
        BM.sound.stopMusic();
        ui.showTitle(game);
        break;
      case 'how': ui.showHow(); break;
      case 'back': ui.showTitle(game); break;
    }
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b) return;
    b.blur();   // フォーカスが残ると、ゲーム中の Space でボタンが再発火する
    act(b.getAttribute('data-act'));
  });

  function onKeyDown(k) {
    if (!game) return;
    if (k === 'm') {
      BM.sound.musicOn = !BM.sound.musicOn;
      if (BM.sound.musicOn && game.state === BM.S_PLAY) BM.sound.startMusic();
      else BM.sound.stopMusic();
      return;
    }
    if (k === 'n') { BM.sound.sfxOn = !BM.sound.sfxOn; return; }

    switch (game.state) {
      case BM.S_TITLE:
        if (k === ' ' || k === 'Enter') act('play');
        break;
      case BM.S_PLAY:
        if (k === 'p' || k === 'Escape') { game.state = BM.S_PAUSE; ui.showPause(); }
        break;
      case BM.S_PAUSE:
        if (k === 'p' || k === 'Escape' || k === ' ' || k === 'Enter') act('resume');
        break;
      case BM.S_OVER:
        if ((k === ' ' || k === 'Enter') && game.stateT > 1.2) act('play');
        break;
    }
  }

  /* ---------- ループ ---------- */
  var last = 0;
  function frame(now) {
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    game.update(dt);
    game.render();
    input.endFrame();
    requestAnimationFrame(frame);
  }

  window.addEventListener('load', function () {
    ui.cache();
    bindTouch();
    game = new BM.Game(document.getElementById('game'));
    BM.game = game;
    ui.showTitle(game);
    requestAnimationFrame(frame);
  });
})(BM);
