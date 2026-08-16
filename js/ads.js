/* =========================================================
   DEEP FALL — ゲームオーバー時のインタースティシャル枠

   ■ この枠は2通りに使える

   (1) 自分のサイトの他のゲームを宣伝する【推奨】
       BM.ads.promos = [
         { title: 'ゲーム名', body: '説明', cta: '遊ぶ',
           url: '/games/xxx', accent: '#ffd23d', tag: 'おすすめ' }
       ];
       BM.ads.onClick = function (promo) { ... };   // 押された時。計測に使う

       外部の広告ネットワークと比べて、審査も同意管理（CMP）も要らず、
       広告ブロッカーにも消されず、外部通信も増えない。
       そして販売サイトなら、広告表示1回より1本売れるほうが桁違いに大きい。

   (2) 外部の広告配信に差し替える
       BM.ads.provider = {
         // container に配信タグを差し込み、表示が終わったら done() を呼ぶ
         fill: function (container, done) { ... }
       };

       ただし外部配信には、審査を通したアカウントと【自分が所有するドメイン】、
       EEA/UK 向けには同意管理（CMP）が要る。
       また Artifact として公開した場合はセキュリティポリシーが
       外部スクリプトを全部止めるので、そこでは動かない。

   どちらの場合も、枠・ラベル・スキップ・頻度制御はそのまま使える。

   ■ 守っていること
     ・標準的な 300×250（レクタングル大）の枠
     ・「広告」ラベルを必ず出す。自社の宣伝でも隠さない（隠せば騙しになる）
     ・カウントダウンと、一定秒後に押せるスキップ
     ・出しすぎない頻度制御（毎回は出さない）
     ・【何があってもスキップだけは効く】。外部スクリプトは落ちるものなので、
       出口を先に組んでから中身を入れる
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
    provider: null,     // 外部の広告配信に差し替えるための口
    everyN: 2,          // 何回のゲームオーバーごとに出すか（毎回は出さない）
    minGapMs: 45000,    // 前回の表示から最低これだけ空ける
    skipAfter: 5,       // 何秒後にスキップを押せるようにするか
    providerTimeoutMs: 8000,  // 外部配信が無反応な時に見切る時間

    /* 自分のサイトに載せる時の差し替え口。
       ここに他のゲームを入れると、ゲームオーバー画面がそのまま
       「次にこれを遊びませんか」の場所になる。
         BM.ads.promos = [
           { title: 'ゲーム名', body: '説明', cta: '遊ぶ',
             url: '/games/xxx', accent: '#ffd23d', tag: 'おすすめ' }
         ];
       外部の広告ネットワークと違って、審査も同意管理も要らず、
       広告ブロッカーにも消されない。販売サイトなら収益もこちらのほうが大きい。 */
    promos: null,

    /* 押された時に呼ばれる。サイト側で計測に使う。
       BM.ads.onClick = function (promo) { ... } */
    onClick: null,

    /* 何と表示するか。「これは宣伝である」ことは隠さない。
       自社の宣伝でも同じ（隠すと、ただの騙しになる）。 */
    label: '広告',

    _count: 0,
    _lastAt: 0,
    _timer: null,
    _fallbackTimer: null,
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
      if (this._fallbackTimer) { clearTimeout(this._fallbackTimer); this._fallbackTimer = null; }
    },

    /* 今回出す中身。promos が入っていればそちらを優先する */
    pick: function () {
      var list = (this.promos && this.promos.length) ? this.promos : HOUSE;
      var c = list[this._pick % list.length];
      this._pick++;
      return c;
    },

    show: function (panel, done) {
      var self = this;
      var creative = this.pick();

      panel.innerHTML =
        '<div class="ad-wrap">' +
        '  <div class="ad-head"><span class="ad-label">' + this.label + '</span>' +
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
        self.cancel();
        done();
      }

      /* 出口を先に作る。
         以前はここが provider の呼び出しより後にあり、外部スクリプトが
         例外を投げるとスキップも カウントダウンも組まれないまま止まった。
         広告ブロッカーや通信の失敗でごく普通に起きるので、
         「何があってもスキップだけは効く」を先に保証する。 */
      var left = this.skipAfter;
      skip.addEventListener('click', function () { if (!skip.disabled) finish(); });
      function openSkip(msg) {
        if (self._timer) { clearInterval(self._timer); self._timer = null; }
        skip.disabled = false;
        count.textContent = '';
        skip.textContent = 'スキップ ▶';
        note.textContent = msg || 'スキップして結果を見る';
      }
      this._timer = setInterval(function () {
        left--;
        if (left > 0) { count.textContent = left; return; }
        openSkip();
      }, 1000);

      /* 自前の中身（自社広告 / サイト内の他ゲーム）を描く */
      function drawCreative() {
        slot.innerHTML =
          '<div class="ad-creative" style="--ad:' + (creative.accent || '#ffd23d') + '">' +
          '  <div class="ad-tag">' + (creative.tag || '自社広告') + '</div>' +
          '  <div class="ad-title">' + creative.title + '</div>' +
          '  <div class="ad-body">' + creative.body + '</div>' +
          '  <div class="ad-cta">' + creative.cta + ' ▶</div>' +
          '</div>';
        slot.addEventListener('click', function () {
          // 行き先があるなら開く。無ければ（このゲーム自身の告知なら）結果画面へ進む
          if (typeof self.onClick === 'function') {
            try { self.onClick(creative); } catch (e) { /* 計測の失敗で進行を止めない */ }
          }
          if (creative.url) {
            try { window.open(creative.url, creative.target || '_blank', 'noopener'); }
            catch (e) { /* 開けなくても結果画面へは進める */ }
          }
          finish();
        });
      }

      if (this.provider && typeof this.provider.fill === 'function') {
        var filled = false;
        try {
          this.provider.fill(slot, function () { filled = true; finish(); });
        } catch (e) {
          // 外部配信が落ちた。枠を空のままにせず、自前の中身に差し替える
          drawCreative();
          openSkip('広告を読み込めませんでした');
          return;
        }
        // 返事が来ない場合の見切り。無反応のまま待たせない
        this._fallbackTimer = setTimeout(function () {
          self._fallbackTimer = null;
          if (filled || finished) return;
          if (!slot.firstChild) drawCreative();
          openSkip('広告を読み込めませんでした');
        }, this.providerTimeoutMs);
      } else {
        drawCreative();
      }
    }
  };

  BM.ads = ads;
})(BM);
