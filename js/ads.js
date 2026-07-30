/* =========================================================
   DEEP FALL — 広告枠（ゲームオーバー時のインタースティシャル）

   ■ 実際の広告配信について
   AdSense / AdMob などの実配信には、審査を通したアカウントと
   配信元ドメインからの外部スクリプト読み込みが必要。
   このゲームは外部通信をしない前提で作ってあり、Artifact として公開した
   場合はセキュリティポリシーが外部スクリプトを全部ブロックする。
   なので「配信そのもの」はここでは行えない。

   代わりにこのモジュールは、広告の【枠と出し方】だけを実装している。
     ・標準的な 300×250（レクタングル大）の枠
     ・「広告」ラベル（何が広告なのかを隠さない）
     ・カウントダウンと、一定秒後に押せるスキップ
     ・出しすぎない頻度制御（毎回は出さない）
   中身の既定値は自社広告（このゲーム自身の告知）。

   ■ 実際の配信に差し替える方法
     BM.ads.provider = {
       // container に配信タグを差し込み、表示が終わったら done() を呼ぶ
       fill: function (container, done) { ... }
     };
   provider を入れれば自社広告の代わりにそれが使われる。
   枠・ラベル・スキップ・頻度制御はそのまま流用できる。
   ========================================================= */
(function (BM) {
  'use strict';

  /* 既定の中身は自社広告。
     実在しない企業や商品を騙るものは作らない（それは偽の広告になる）ので、
     このゲーム自身のことだけを書いている。 */
  var HOUSE = [
    {
      accent: '#ffd23d',
      tag: '自社広告',
      title: 'まだ 500m は見ていない',
      body: '地層は 100m ごとに姿を変える。表土・玄武岩・結晶層・熱層・氷結層、' +
            'そして 500m から先はずっと「深淵」。',
      cta: 'もう一度落ちる'
    },
    {
      accent: '#8ce8ff',
      tag: '自社広告',
      title: 'シールドは読み違えを1回だけ許す',
      body: '🛡 を拾うと、岩に触れても死なずに突き破る。持っている間は' +
            '落下予測線が青くなるので、今が安全かは常に見えている。',
      cta: 'シールドを探しに行く'
    },
    {
      accent: '#ff8a5c',
      tag: '自社広告',
      title: '爆弾は腰のポーチに3個だけ',
      body: '全面岩の層は壁のボタンで抜ける。爆弾は本当に詰まった時の切り札。' +
            'どこで使うかを決めてから落とす。',
      cta: '使いどころを試す'
    },
    {
      accent: '#c9a6ff',
      tag: '自社広告',
      title: '埋まった爆弾を撃ち抜くと大穴になる',
      body: 'オレンジに光る岩に自分の爆弾を当てると誘爆する。' +
            '連鎖するほど得点が伸びる、唯一の稼ぎ所。',
      cta: '誘爆を狙う'
    }
  ];

  var ads = {
    enabled: true,
    provider: null,     // 実配信に差し替えるための口
    everyN: 2,          // 何回のゲームオーバーごとに出すか（毎回は出さない）
    minGapMs: 45000,    // 前回の表示から最低これだけ空ける
    skipAfter: 5,       // 何秒後にスキップを押せるようにするか
    _count: 0,
    _lastAt: 0,
    _timer: null,
    _pick: 0,

    /* 今回は出すか。出しすぎると、ただ邪魔なだけになる。 */
    shouldShow: function () {
      if (!this.enabled) return false;
      this._count++;
      if (this._count % this.everyN !== 0) return false;
      var now = Date.now();
      if (now - this._lastAt < this.minGapMs) return false;
      return true;
    },

    /* 出す必要が無ければ done() をそのまま呼ぶので、
       呼び出し側は毎回これを通せばよい。 */
    maybeShow: function (panel, done) {
      if (!this.shouldShow()) { done(); return; }
      this._lastAt = Date.now();
      this.show(panel, done);
    },

    /* 表示中に画面が切り替わった時の後始末 */
    cancel: function () {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
    },

    show: function (panel, done) {
      var self = this;
      var creative = HOUSE[this._pick % HOUSE.length];
      this._pick++;

      panel.innerHTML =
        '<div class="ad-wrap">' +
        '  <div class="ad-head"><span class="ad-label">広告</span>' +
        '    <span class="ad-note" id="ad-note">' + this.skipAfter + ' 秒後にスキップできます</span></div>' +
        '  <div class="ad-slot" id="ad-slot"></div>' +
        '  <button class="ad-skip" id="ad-skip" disabled>スキップ <span id="ad-count">' +
             this.skipAfter + '</span></button>' +
        '</div>';

      var slot = panel.querySelector('#ad-slot');
      var skip = panel.querySelector('#ad-skip');
      var count = panel.querySelector('#ad-count');
      var note = panel.querySelector('#ad-note');

      var finished = false;
      function finish() {
        if (finished) return;
        finished = true;
        if (self._timer) { clearInterval(self._timer); self._timer = null; }
        done();
      }

      if (this.provider && typeof this.provider.fill === 'function') {
        // 実配信。表示が終わったら provider 側から done を呼ばせる
        this.provider.fill(slot, finish);
      } else {
        slot.innerHTML =
          '<div class="ad-creative" style="--ad:' + creative.accent + '">' +
          '  <div class="ad-tag">' + creative.tag + '</div>' +
          '  <div class="ad-title">' + creative.title + '</div>' +
          '  <div class="ad-body">' + creative.body + '</div>' +
          '  <div class="ad-cta">' + creative.cta + ' ▶</div>' +
          '</div>';
        // 自社広告なので、クリックしたらそのまま結果画面へ進める
        slot.addEventListener('click', finish);
      }

      var left = this.skipAfter;
      skip.addEventListener('click', function () { if (!skip.disabled) finish(); });
      this._timer = setInterval(function () {
        left--;
        if (left > 0) { count.textContent = left; return; }
        clearInterval(self._timer); self._timer = null;
        skip.disabled = false;
        count.textContent = '';
        skip.textContent = 'スキップ ▶';
        note.textContent = 'スキップして結果を見る';
      }, 1000);
    }
  };

  BM.ads = ads;
})(BM);
