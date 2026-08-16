/* =========================================================
   DEEP FALL — 端末チェック（実機での確認用）

   実機テストで一番困るのは「何が起きたかを持ち帰れないこと」。
   スマホで触って「なんか変だった」とだけ分かっても直せない。
   そこでこの画面が、

     ・機械で分かることは自動で判定する（画面サイズ・押す的の寸法・
       はみ出し・fps・音が鳴る状態か・保存が効くか）
     ・実機でしか分からないことは、その場で ○ / × を付けられる
     ・全部まとめてテキストにして、コピーできる

   ようにしてある。コピーしたものをそのまま貼れば報告になる。

   タイトルの「📱 端末チェック」か、URL に ?device=1 で開く。
   ========================================================= */
(function (BM) {
  'use strict';

  // 指で押す的の最小寸法。Apple HIG は 44pt、WCAG 2.5.5 も 44px を目安にしている
  var MIN_TAP = 44;

  /* 実機でしか分からないこと。ここは人が判定する。
     「動くかどうか」ではなく「遊べるかどうか」を聞く。 */
  var MANUAL = [
    { id: 'thumb',  q: '左右のボタンに親指が自然に届く' },
    { id: 'aim',    q: '落ちながら狙った隙間へ寄せられる' },
    { id: 'coin',   q: '結晶（💠）を狙って拾える' },
    { id: 'bomb',   q: '爆弾ボタンを押し間違えない' },
    { id: 'read',   q: '岩と隙間が見分けられる（小さすぎない）' },
    { id: 'hud',    q: '深度・爆弾の残数が読める' },
    { id: 'sound',  q: '音が出る（マナーモードを解除して）' },
    { id: 'smooth', q: '動きが引っかからない' },
    { id: 'hot',    q: '数分遊んでも熱くならない・電池が急に減らない' }
  ];

  var state = {};   // id -> true / false / null
  var fps = null;

  function el(id) { return document.getElementById(id); }

  /* 自動で判定できるもの。実機の値をそのまま読む */
  function auto() {
    var se = document.scrollingElement;
    var touch = el('touch');
    var btns = [].slice.call(document.querySelectorAll('#touch .tbtn')).map(function (b) {
      var q = b.getBoundingClientRect();
      return { key: b.getAttribute('data-key'), w: Math.round(q.width), h: Math.round(q.height) };
    });
    var minTap = btns.length ? Math.min.apply(null, btns.map(function (b) { return Math.min(b.w, b.h); })) : 0;
    var labels = [].slice.call(document.querySelectorAll('.hud-label')).map(function (l) {
      return l.getBoundingClientRect();
    });
    var cv = el('game').getBoundingClientRect();
    var store = (function () {
      try {
        window.localStorage.setItem('deepfall.probe', '1');
        var ok = window.localStorage.getItem('deepfall.probe') === '1';
        window.localStorage.removeItem('deepfall.probe');
        return ok;
      } catch (e) { return false; }
    })();
    var ctx = BM.sound && BM.sound.ctx;

    return {
      view: innerWidth + '×' + innerHeight + ' / dpr ' + (devicePixelRatio || 1),
      orient: innerWidth > innerHeight ? '横' : '縦',
      touchPoints: navigator.maxTouchPoints || 0,
      coarse: matchMedia('(hover:none) and (pointer:coarse)').matches,
      touchShown: touch ? getComputedStyle(touch).display !== 'none' : false,
      btns: btns, minTap: minTap,
      hScroll: se.scrollWidth - se.clientWidth,
      vScroll: se.scrollHeight - se.clientHeight,
      labelsVisible: labels.length > 0 && labels.every(function (q) { return q.top >= 0 && q.left >= 0; }),
      canvas: Math.round(cv.width) + '×' + Math.round(cv.height),
      covered: typeof BM.isCovered === 'function' ? BM.isCovered() : false,
      audio: ctx ? ctx.state : '未開始',
      reduced: BM.a11y.reduced,
      reducedFrom: BM.a11y.pref() === null ? 'OS の設定' : '手動',
      store: store,
      ua: navigator.userAgent
    };
  }

  /* 自動判定の合否。実機で壊れていたら困るものだけを ○×する */
  function verdicts(a) {
    var v = [];
    v.push({ ok: a.coarse === a.touchShown, q: '指で触る端末なら操作ボタンが出る',
             got: a.touchShown ? '出ている' : '出ていない' });
    if (a.touchShown) {
      v.push({ ok: a.minTap >= MIN_TAP, q: '押す的が ' + MIN_TAP + 'px 以上',
               got: '最小 ' + a.minTap + 'px' });
    }
    v.push({ ok: a.hScroll <= 0, q: '横スクロールが出ない', got: a.hScroll + 'px' });
    v.push({ ok: a.covered || a.vScroll <= 0, q: 'スクロールなしで全部入る',
             got: a.covered ? '横持ち（案内中）' : 'はみ出し ' + a.vScroll + 'px' });
    v.push({ ok: a.labelsVisible, q: 'HUD のラベルが全部見える', got: a.labelsVisible ? '見える' : '切れている' });
    v.push({ ok: a.store, q: '記録が保存できる', got: a.store ? '使える' : '使えない' });
    if (fps != null) {
      v.push({ ok: fps >= 45, q: '45fps 以上出る', got: fps.toFixed(0) + 'fps' });
    }
    return v;
  }

  function mark(x) { return x === true ? '○' : (x === false ? '×' : '－'); }

  function render() {
    var a = auto();
    var v = verdicts(a);
    var h = '';

    h += '<h2 style="font-size:20px;margin-bottom:2px">📱 端末チェック</h2>';
    h += '<div class="sub" style="margin-bottom:10px">この結果をコピーして送れば、そのまま報告になります</div>';

    h += '<div class="dev-sec">自動判定</div>';
    h += '<div class="dev-list">';
    v.forEach(function (r) {
      h += '<div class="dev-row"><span class="dev-mark ' + (r.ok ? 'ok' : 'ng') + '">' +
           (r.ok ? '○' : '×') + '</span><span class="dev-q">' + r.q +
           '</span><span class="dev-got">' + r.got + '</span></div>';
    });
    if (fps == null) {
      h += '<div class="dev-row"><span class="dev-mark">…</span><span class="dev-q">fps を測る</span>' +
           '<span class="dev-got"><button class="dev-btn" data-dev="fps">測る</button></span></div>';
    }
    h += '</div>';

    h += '<div class="dev-sec">実機で確かめること<small>（触ってから ○ か × を押す）</small></div>';
    h += '<div class="dev-list">';
    MANUAL.forEach(function (m) {
      var s = state[m.id];
      h += '<div class="dev-row"><span class="dev-mark ' +
           (s === true ? 'ok' : s === false ? 'ng' : '') + '">' + mark(s) + '</span>' +
           '<span class="dev-q">' + m.q + '</span>' +
           '<span class="dev-got">' +
           '<button class="dev-btn' + (s === true ? ' on' : '') + '" data-dev="y:' + m.id + '">○</button>' +
           '<button class="dev-btn' + (s === false ? ' on ng' : '') + '" data-dev="n:' + m.id + '">×</button>' +
           '</span></div>';
    });
    h += '</div>';

    h += '<div class="dev-sec">端末</div>';
    h += '<div class="dev-info">' +
         '画面 ' + a.view + '（' + a.orient + '）／ゲーム画面 ' + a.canvas + '<br>' +
         'タッチ点 ' + a.touchPoints + '／音 ' + a.audio +
         '／演出の抑制 ' + (a.reduced ? 'ON' : 'OFF') + '（' + a.reducedFrom + '）<br>' +
         '<span class="dev-ua">' + a.ua + '</span></div>';

    h += '<div class="menu" style="margin-top:12px">' +
         '<button data-dev="copy">📋 結果をコピー</button>' +
         '<button data-act="title">◀ タイトルへ</button>' +
         '</div>';
    h += '<div class="dev-note" id="dev-note"></div>';

    BM.ui.show('<div class="dev-wrap">' + h + '</div>');
    var panel = el('panel');
    panel.classList.add('dev');
    // ボタンは1か所でまとめて受ける（作り直しのたびに付け直さなくて済む）
    panel.onclick = function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-dev]') : null;
      if (!b) return;
      var cmd = b.getAttribute('data-dev');
      b.blur();
      if (cmd === 'fps') { measureFps(); return; }
      if (cmd === 'copy') { copyReport(); return; }
      var m = /^([yn]):(.+)$/.exec(cmd);
      if (m) {
        var id = m[2], want = m[1] === 'y';
        state[id] = (state[id] === want) ? null : want;   // 同じものを押したら取り消し
        render();
      }
    };
  }

  /* fps はその端末の実測でないと意味がないので、この場で測る */
  function measureFps() {
    var note = el('dev-note');
    if (note) note.textContent = '2秒間 測っています…';
    var n = 0, t0 = performance.now();
    (function tick() {
      n++;
      var dt = performance.now() - t0;
      if (dt >= 2000) { fps = n / (dt / 1000); render(); return; }
      requestAnimationFrame(tick);
    })();
  }

  function report() {
    var a = auto();
    var v = verdicts(a);
    var L = [];
    L.push('DEEP FALL 端末チェック');
    L.push('画面 ' + a.view + '（' + a.orient + '）/ ゲーム画面 ' + a.canvas);
    L.push('タッチ点 ' + a.touchPoints + ' / 操作ボタン ' + (a.touchShown ? '出ている' : '出ていない') +
           ' / 押す的 最小 ' + a.minTap + 'px');
    L.push('音 ' + a.audio + ' / 演出の抑制 ' + (a.reduced ? 'ON' : 'OFF') + '（' + a.reducedFrom + '）' +
           ' / 保存 ' + (a.store ? '使える' : '使えない'));
    L.push('fps ' + (fps == null ? '未計測' : fps.toFixed(0)));
    L.push('');
    L.push('[自動判定]');
    v.forEach(function (r) { L.push((r.ok ? '○ ' : '× ') + r.q + ' … ' + r.got); });
    L.push('');
    L.push('[実機で確かめること]');
    MANUAL.forEach(function (m) { L.push(mark(state[m.id]) + ' ' + m.q); });
    var ng = MANUAL.filter(function (m) { return state[m.id] === false; });
    var un = MANUAL.filter(function (m) { return state[m.id] == null; });
    L.push('');
    L.push('× が付いたもの: ' + (ng.length ? ng.map(function (m) { return m.q; }).join(' / ') : 'なし'));
    if (un.length) L.push('未判定: ' + un.length + ' 件');
    L.push('');
    L.push(a.ua);
    return L.join('\n');
  }

  function copyReport() {
    var txt = report();
    var note = el('dev-note');
    var done = function (ok) {
      if (!note) return;
      note.textContent = ok ? 'コピーしました。そのまま貼って送ってください。'
                            : 'コピーできませんでした。下の文字を長押しで選んでください。';
      if (!ok) {
        var ta = document.createElement('textarea');
        ta.className = 'dev-out';
        ta.readOnly = true;
        ta.value = txt;
        note.appendChild(ta);
        ta.focus(); ta.select();
      }
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { done(true); }, function () { done(false); });
        return;
      }
    } catch (e) { /* 下の手動コピーへ */ }
    done(false);
  }

  BM.devicecheck = {
    open: function () { fps = null; render(); },
    report: report,
    auto: auto,
    verdicts: function () { return verdicts(auto()); },
    MANUAL: MANUAL,
    MIN_TAP: MIN_TAP
  };
})(BM);
