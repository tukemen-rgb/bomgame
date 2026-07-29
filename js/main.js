/* =========================================================
   BLAST RUSH — 入力 / UI / メインループ
   ========================================================= */
(function (BM) {
  'use strict';

  /* ---------------------------------------------------------
     入力
     --------------------------------------------------------- */
  var input = {
    keys: {},
    just: {},
    axisPriority: {},
    pressed: function (k) { return !!this.just[k]; },
    endFrame: function () { this.just = {}; }
  };
  BM.input = input;

  function normKey(e) {
    var k = e.key;
    if (k.length === 1) return k.toLowerCase();
    return k;
  }

  var HANDLED = {
    'ArrowUp': 1, 'ArrowDown': 1, 'ArrowLeft': 1, 'ArrowRight': 1, ' ': 1, 'Enter': 1
  };

  window.addEventListener('keydown', function (e) {
    var k = normKey(e);
    if (HANDLED[k]) e.preventDefault();
    if (!input.keys[k]) input.just[k] = true;
    input.keys[k] = true;
    BM.sound.init();
    onKeyDown(k);
  });
  window.addEventListener('keyup', function (e) {
    var k = normKey(e);
    input.keys[k] = false;
  });
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

  /* ---------------------------------------------------------
     UI
     --------------------------------------------------------- */
  var el = {};
  var ui = {
    _comboTimer: null,

    cache: function () {
      el.overlay = document.getElementById('overlay');
      el.panel = document.getElementById('panel');
      el.score = document.getElementById('hud-score');
      el.stage = document.getElementById('hud-stage');
      el.time = document.getElementById('hud-time');
      el.life = document.getElementById('hud-life');
      el.power = document.getElementById('hud-power');
      el.combo = document.getElementById('combo-banner');
      el.inkbar = document.getElementById('inkbar');
      el.ink1 = document.getElementById('ink-1');
      el.ink2 = document.getElementById('ink-2');
      el.inkTarget = document.getElementById('ink-target');
      el.inkNum1 = document.getElementById('ink-num-1');
      el.inkNum2 = document.getElementById('ink-num-2');
      el.inkCaption = document.getElementById('ink-caption');
    },

    hide: function () { el.overlay.classList.add('hidden'); },
    show: function (html) {
      el.panel.innerHTML = html;
      el.overlay.classList.remove('hidden');
    },

    combo: function (text) {
      el.combo.textContent = text;
      el.combo.classList.remove('show');
      void el.combo.offsetWidth; // reflow でアニメを再start
      el.combo.classList.add('show');
    },

    bump: function (node) {
      node.classList.remove('bump');
      void node.offsetWidth;
      node.classList.add('bump');
    },

    _lastScore: -1, _lastLife: -1, _lastPower: '',

    syncHud: function (g) {
      if (g.score !== this._lastScore) {
        el.score.textContent = g.score.toLocaleString('en-US');
        if (g.score > this._lastScore && this._lastScore >= 0) this.bump(el.score);
        this._lastScore = g.score;
      }
      var t = Math.ceil(g.timeLeft);
      el.time.textContent = t;
      el.time.classList.toggle('warn', t <= 15);

      // 塗り面積バー
      var r1 = Math.round(g.myRatio * 100), r2 = Math.round(g.foeRatio * 100);
      el.ink1.style.width = r1 + '%';
      el.ink2.style.width = r2 + '%';
      el.inkNum1.textContent = r1 + '%';
      el.inkNum2.textContent = r2 + '%';
      if (g.mode === 'vs') {
        el.inkbar.classList.remove('has-target', 'reached');
        el.inkCaption.textContent = '塗り面積で勝負';
      } else {
        el.inkbar.classList.add('has-target');
        el.inkTarget.style.left = (g.targetRatio * 100) + '%';
        var done = g.myRatio >= g.targetRatio;
        el.inkbar.classList.toggle('reached', done);
        el.inkCaption.textContent = done
          ? '出口が開いた'
          : 'ノルマ ' + Math.round(g.targetRatio * 100) + '%';
      }

      if (g.mode === 'vs') {
        el.stage.textContent = 'VS';
        var p1 = g.players[0], p2 = g.players[1];
        el.life.textContent = (p1 ? p1.wins : 0) + ' - ' + (p2 ? p2.wins : 0);
        el.power.textContent = '先に3勝';
        return;
      }

      el.stage.textContent = g.stage;
      var p = g.players[0];
      if (!p) return;
      var lives = Math.max(0, p.lives);
      if (lives !== this._lastLife) {
        el.life.textContent = lives > 5 ? '♥×' + lives : new Array(lives + 1).join('♥') || '—';
        this._lastLife = lives;
      }
      var ps = '💣' + p.maxBombs + ' 🔥' + p.power + ' ⚡' + (p.speedLv + 1) +
        (p.kick ? ' 🦵' : '') + (p.pierce ? ' ✴' : '') + (p.remote ? ' 📡' : '') +
        (p.shield ? ' 🛡' + p.shield : '');
      if (ps !== this._lastPower) { el.power.textContent = ps; this._lastPower = ps; }
    },

    resetHudCache: function () {
      this._lastScore = -1; this._lastLife = -1; this._lastPower = '';
    },

    /* ---- 画面 ---- */

    showTitle: function (g) {
      this.show(
        '<h1>BLAST RUSH</h1>' +
        '<div class="sub">爆風は、武器じゃない。<b style="color:#7fe4ff">絵筆だ。</b></div>' +
        '<div class="menu">' +
        '<button data-act="solo">▶ ひとりで塗る<small>爆風で床を塗り、ノルマ達成で出口が開く</small></button>' +
        '<button data-act="vs">⚔ 2人で塗り合い<small>時間切れ時点で塗り面積の広いほうがラウンド勝ち</small></button>' +
        '<button data-act="how">📖 あそびかた</button>' +
        '</div>' +
        '<div class="tips">ハイスコア <b>' + g.bestScore.toLocaleString('en-US') + '</b></div>'
      );
    },

    showHow: function () {
      this.show(
        '<h2>あそびかた</h2>' +
        '<div class="tips" style="text-align:left;font-size:12.5px">' +
        '<p><b>1P</b> <code>←↑↓→</code> 移動 / <code>Space</code> 爆弾 / <code>Enter</code> リモコン起爆<br>' +
        '<b>2P</b> <code>W A S D</code> 移動 / <code>F</code> 爆弾 / <code>G</code> リモコン起爆</p>' +
        '<p><b style="color:#7fe4ff">このゲームの勝敗は「倒した数」ではなく「塗った面積」で決まる。</b><br>' +
        '爆風が通った床は自分の色に染まる。1人用はノルマ塗り率で出口が開き、' +
        '対戦は時間切れ時点の面積で勝敗が決まる。</p>' +
        '<p><b>自分の色の床は速く走れて、相手の色の床では遅くなる。</b><br>' +
        '塗る → 動きやすくなる → もっと塗れる、の好循環をどれだけ早く回せるかが勝負。<br>' +
        'やられると足元の自陣が中立に戻るので、死ぬこと自体が失点になる。</p>' +
        '<p>爆弾は約2.2秒で十字に爆発。爆風は硬い壁で止まり、ソフトブロックを1枚壊す。<br>' +
        '爆風に触れた爆弾は<b>誘爆</b>する。連鎖させるほど一度に塗れる面積が跳ね上がる。<br>' +
        '敵を倒すと、その場に自分のインクが飛び散る。</p>' +
        '<p><b>アイテム</b><br>' +
        '🔥 火力アップ ／ 💣 爆弾の数 ／ ⚡ スピード<br>' +
        '🦵 キック（爆弾を蹴って飛ばす） ／ ✴ 貫通爆弾（ブロックを貫く）<br>' +
        '📡 リモコン（起爆キーで好きなタイミングに） ／ 🛡 シールド ／ ♥ 残機 ／ ☀ フルファイア</p>' +
        '<p>床が赤く点滅しているマスは<b>これから爆風が来る場所</b>。ここを読めば死なない。<br>' +
        '敵は歩いた跡を敵色に汚していくので、放置すると塗り率がじりじり削られる。<br>' +
        '時間切れになると敵が暴走するので注意。</p>' +
        '</div>' +
        '<div class="menu"><button data-act="back">◀ もどる</button></div>'
      );
    },

    showStageClear: function (g) {
      this.show(
        '<h2>STAGE ' + g.stage + ' CLEAR!</h2>' +
        '<div class="rows">' +
        '<div class="stat">最終塗り率 <b style="color:#7fe4ff">' + Math.round(g.clearRatio * 100) + '%</b>' +
        ' <span style="opacity:.6">/ ノルマ ' + Math.round(g.targetRatio * 100) + '%</span></div>' +
        '<div class="stat">塗りボーナス <b>' + g.bonusInk.toLocaleString('en-US') + '</b></div>' +
        '<div class="stat">タイムボーナス <b>' + g.bonusTime.toLocaleString('en-US') + '</b></div>' +
        '<div class="stat">残機ボーナス <b>' + g.bonusLife.toLocaleString('en-US') + '</b></div>' +
        '<div class="stat">SCORE <b>' + g.score.toLocaleString('en-US') + '</b></div>' +
        '</div>' +
        '<div class="menu"><button data-act="next">▶ STAGE ' + (g.stage + 1) + ' へ</button></div>' +
        '<div class="blink">Space / Enter でも進めます</div>'
      );
    },

    showGameOver: function (g) {
      var best = g.score >= g.bestScore;
      this.show(
        '<h2 style="color:#ff5470">GAME OVER</h2>' +
        '<div class="rows">' +
        '<div class="stat">到達ステージ <b>' + g.stage + '</b></div>' +
        '<div class="stat">SCORE <b>' + g.score.toLocaleString('en-US') + '</b></div>' +
        (best ? '<div class="blink">★ ハイスコア更新！</div>'
              : '<div class="stat">BEST <b>' + g.bestScore.toLocaleString('en-US') + '</b></div>') +
        '</div>' +
        '<div class="menu">' +
        '<button data-act="solo">↻ もう一度</button>' +
        '<button data-act="title">◀ タイトルへ</button>' +
        '</div>'
      );
    },

    showRoundResult: function (g) {
      var p1 = g.players[0], p2 = g.players[1];
      var done = p1.wins >= 3 || p2.wins >= 3;
      var head;
      if (done) head = '<h2>' + (p1.wins >= 3 ? '1P' : '2P') + ' の勝利！</h2>';
      else if (g.roundWinner) head = '<h2>' + g.roundWinner.name + ' がラウンド獲得</h2>';
      else head = '<h2>引き分け</h2>';

      var c = g.finalCounts || { 1: 0, 2: 0, total: 1 };
      var pc = function (n) { return Math.round(n / (c.total || 1) * 100) + '%'; };

      this.show(
        head +
        '<div class="rows">' +
        '<div class="stat">塗り面積 ' +
        '<b style="color:#5ad2ff">1P ' + pc(c[1]) + '</b> — ' +
        '<b style="color:#ff7ac8">' + pc(c[2]) + ' 2P</b></div>' +
        '<div class="stat">ラウンド 1P <b>' + p1.wins + '</b> — <b>' + p2.wins + '</b> 2P</div>' +
        '</div>' +
        '<div class="menu">' +
        (done ? '<button data-act="vs">↻ もう一度</button>' : '<button data-act="nextround">▶ 次のラウンド</button>') +
        '<button data-act="title">◀ タイトルへ</button>' +
        '</div>'
      );
    },

    showPause: function () {
      this.show(
        '<h2>PAUSE</h2>' +
        '<div class="menu">' +
        '<button data-act="resume">▶ 再開</button>' +
        '<button data-act="title">◀ タイトルへ</button>' +
        '</div>' +
        '<div class="tips">音楽 <code>M</code> / 効果音 <code>N</code></div>'
      );
    }
  };
  BM.ui = ui;

  /* ---------------------------------------------------------
     ゲーム進行
     --------------------------------------------------------- */
  var game;

  function act(name) {
    BM.sound.init();
    switch (name) {
      case 'solo':
        ui.resetHudCache();
        game.newRun('solo');
        ui.hide();
        BM.sound.startMusic();
        break;
      case 'vs':
        ui.resetHudCache();
        game.newRun('vs');
        ui.hide();
        BM.sound.startMusic();
        break;
      case 'next':
        game.startStage(game.stage + 1, false);
        ui.hide();
        break;
      case 'nextround':
        game.startVsRound();
        ui.hide();
        break;
      case 'resume':
        game.state = BM.S_PLAY;
        ui.hide();
        break;
      case 'title':
        game.toTitle();
        ui.showTitle(game);
        BM.sound.stopMusic();
        break;
      case 'how':
        ui.showHow();
        break;
      case 'back':
        ui.showTitle(game);
        break;
    }
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b) return;
    // フォーカスが残っているとゲーム中の Space / Enter でボタンが再発火してしまう
    b.blur();
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
        if (k === ' ' || k === 'Enter') act('solo');
        break;
      case BM.S_PLAY:
        if (k === 'p' || k === 'Escape') { game.state = BM.S_PAUSE; ui.showPause(); }
        break;
      case BM.S_PAUSE:
        if (k === 'p' || k === 'Escape' || k === ' ' || k === 'Enter') act('resume');
        break;
      case BM.S_CLEAR:
        if ((k === ' ' || k === 'Enter') && game.stateT > 0.5) act('next');
        break;
      case BM.S_VSROUND:
        if ((k === ' ' || k === 'Enter') && game.stateT > 0.5) {
          var done = game.players[0].wins >= 3 || game.players[1].wins >= 3;
          act(done ? 'vs' : 'nextround');
        }
        break;
      case BM.S_OVER:
        // 爆弾キーの押しっぱなしで即リスタートしないよう、少し待たせる
        if ((k === ' ' || k === 'Enter') && game.stateT > 1.4) act('solo');
        break;
    }
  }

  /* ---------------------------------------------------------
     ループ
     --------------------------------------------------------- */
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
