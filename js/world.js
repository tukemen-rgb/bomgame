/* =========================================================
   DEEP FALL — 縦坑の生成

   無限に下へ続く。一定間隔で「地層」を挟み、そこに隙間を作る。
   隙間の作り方が このゲームの語彙そのものなので、種類を増やしてある。

   生成時に必ず守ること：
     ・直前の隙間から横移動が間に合う位置にしか次の隙間を置かない
       （落下は止められないので、届かない隙間は理不尽death になる）
     ・動く地層は完全には閉じない（到着タイミングで詰むのを防ぐ）
     ・ボタン式の全面岩は、ボタンを直前の隙間に近い側の壁に置く
   ========================================================= */
(function (BM) {
  'use strict';

  var COLS = BM.COLS, L = BM.PLAY_L, R = BM.PLAY_R, TILE = BM.TILE;

  /* 落下中に横へ何マス動けるか */
  function reachTiles(dropRows, vTerm) {
    return (BM.MOVE_SPEED * (dropRows * TILE / vTerm) * BM.REACH_MARGIN) / TILE;
  }

  function newCells(fill) {
    var c = new Uint8Array(COLS);
    for (var i = 0; i < COLS; i++) c[i] = (i < L || i > R) ? BM.T_ROCK : fill;
    return c;
  }

  /* 動く穴の角速度の上限。
     穴がプレイヤーの横移動より速く逃げると、追いつけず理不尽になる。
     振幅 span/2 タイルの往復なので、最大速度 = span/2 * 角速度 [タイル/秒]。 */
  function maxAngular(spanTiles) {
    var maxPx = BM.MOVE_SPEED * 0.55;
    return maxPx / (TILE * Math.max(1, spanTiles / 2));
  }

  function carve(cells, x, w) {
    var half = (w - 1) / 2;
    for (var i = Math.round(x - half); i <= Math.round(x + half); i++) {
      if (i >= L && i <= R) cells[i] = BM.T_EMPTY;
    }
  }

  /* =========================================================
     地層の種類
     各ビルダーは layer を組み立てて、通り抜けられる代表列を gapX に入れる
     ========================================================= */
  var BUILDERS = {

    /* 素直な穴 */
    gap: function (layer, cfg) {
      layer.cells = newCells(BM.T_ROCK);
      carve(layer.cells, layer.gapX, cfg.gapW);
      layer.hint = '';
      var h = (cfg.gapW - 1) / 2;
      layer.exit = [layer.gapX - h, layer.gapX + h];
    },

    /* 穴が2つ。広いほうが安全、狭いほうが近道。
       どちらを抜けても次の層に届くよう、2つの間隔は広げすぎない。 */
    twin: function (layer, cfg) {
      layer.cells = newCells(BM.T_ROCK);
      carve(layer.cells, layer.gapX, cfg.gapW);
      // 2つ目も「直前の出口から届く窓」の中に置く。
      // ここを外すと、そちらを選んだ瞬間に届かなくなる。
      var lo = Math.max(L, cfg.allowedLo), hi = Math.min(R, cfg.allowedHi);
      var spread = BM.randInt(3, 5) * (Math.random() < 0.5 ? -1 : 1);
      var other = BM.clamp(layer.gapX + spread, lo, hi);
      if (Math.abs(other - layer.gapX) < 3) other = BM.clamp(layer.gapX - spread, lo, hi);
      if (Math.abs(other - layer.gapX) < 2) other = layer.gapX;
      carve(layer.cells, other, 1);
      layer.altGapX = other;
      layer.exit = [Math.min(layer.gapX, other), Math.max(layer.gapX, other)];
    },

    /* 一面もろい岩。ぶつかれば砕けるが、そのぶん落下が鈍る。
       どこでも抜けられる＝出口が自由なので exit は全幅 */
    crack: function (layer) {
      layer.cells = newCells(BM.T_CRACK);
      layer.hint = 'もろい';
      layer.exit = [L, R]; layer.exitFree = true;
    },

    /* 岩ともろい岩の混在。どこを抜けるか選ぶ */
    crackmix: function (layer, cfg) {
      layer.cells = newCells(BM.T_ROCK);
      for (var i = -2; i <= 2; i++) {
        var c = Math.round(layer.gapX) + i;
        if (c >= L && c <= R) layer.cells[c] = BM.T_CRACK;
      }
      if (cfg.gapW > 1) carve(layer.cells, layer.gapX, 1);
      layer.exit = [layer.gapX - 2, layer.gapX + 2];
    },

    /* 全面岩。壁のボタンを蹴ると爆弾が落ちてきて穴が開く。
       ボタンは層より上にあるので、そこへ届く時間で側を決める必要がある。
       間に合わない配置になるくらいなら、この層だけ落差を伸ばす。 */
    button: function (layer, cfg) {
      layer.cells = newCells(BM.T_ROCK);
      // 左右どちらの壁にも置く。片側だけだと、反対の壁側から来たときに
      // 横移動が間に合わず理不尽になる（どちら側にいても最大6マスで届く）。
      var y = layer.row - cfg.buttonOffset;
      layer.buttons = [
        { col: L, row: y, side: -1, hit: false, t: 0 },
        { col: R, row: y, side: 1, hit: false, t: 0 }
      ];
      layer.gapX = (L + R) / 2;
      layer.hint = 'ボタン';
      layer.exit = [L, R];      // どちらの壁を使ったかで出口が変わる
    },

    /* 穴が横にスライドし続ける */
    shutter: function (layer, cfg) {
      layer.dynamic = true;
      layer.gapW = cfg.gapW + 1;
      // 全幅を往復させると、直前の出口から届かない位置に穴が来ることがある。
      // 到達可能な gapX を中心に、振幅を絞って往復させる。
      var amp = 3;   // 落差の間に横断し切れる幅に抑える
      layer.range = [
        Math.max(L, Math.round(layer.gapX) - amp),
        Math.min(R, Math.round(layer.gapX) + amp)
      ];
      if (layer.range[1] - layer.range[0] < 3) {
        layer.range = [Math.max(L, Math.min(R - 3, layer.range[0])), 0];
        layer.range[1] = layer.range[0] + 3;
      }
      var cap = maxAngular(layer.range[1] - layer.range[0]);
      layer.speed = BM.rand(cap * 0.5, cap) * (Math.random() < 0.5 ? -1 : 1);
      layer.refresh = function (t) {
        var span = this.range[1] - this.range[0];
        var u = (Math.sin(t * this.speed) + 1) / 2;
        var x = this.range[0] + u * span;
        this.cells = newCells(BM.T_ROCK);
        carve(this.cells, x, this.gapW);
        this.gapX = x;
      };
      layer.hint = '横に動く';
      // 抜ける位置は穴の位置＝到着タイミングで決まるので、自分では選べない。
      // exitFree にすると「好きな場所に構えられる」前提で次の穴が置かれ、
      // 届かない配置が生まれる。往復範囲の端から端まで届く位置に限る。
      layer.exit = [layer.range[0], layer.range[1]];
    },

    /* 穴が広がったり狭まったりする。閉じ切りはしない（詰み防止） */
    gate: function (layer, cfg) {
      layer.dynamic = true;
      layer.speed = BM.rand(0.9, 1.4);
      layer.wide = Math.max(4, cfg.gapW + 2);
      layer.refresh = function (t) {
        var u = (Math.sin(t * this.speed) + 1) / 2;
        // 最小でも2マス残す。1マスまで閉じると、到着タイミング次第で
        // どうやっても避けられない瞬間ができてしまう
        var w = 2 + Math.round(u * (this.wide - 2));
        this.cells = newCells(BM.T_ROCK);
        carve(this.cells, this.gapX, w);
        this.curW = w;
      };
      layer.hint = '開閉';
      layer.exit = [layer.gapX, layer.gapX];   // 位置は固定。狭まる瞬間があるので厳しく見る
    },

    /* 一定の間隔を保った2つの穴が、揃って左右にスライドする。
       以前は左右から寄っては離れる形にしていたが、すれ違う瞬間に
       「今は開いているが直後に岩になる中央」ができ、そこを狙うと必ず死ぬ罠になっていた。
       間隔を固定すれば、どちらの穴を選んでも最後まで穴のまま。 */
    spinner: function (layer, cfg) {
      layer.dynamic = true;
      layer.mid = BM.clamp(Math.round(layer.gapX), L + 2, R - 2);
      layer.sep = 2.5;
      layer.amp = 1.5;
      layer.speed = maxAngular(layer.amp * 2) * BM.rand(0.5, 0.95);
      layer.gapW = cfg.gapW;
      layer.refresh = function (t) {
        var s = Math.sin(t * this.speed) * this.amp;
        var a = this.mid - this.sep + s;
        var b = this.mid + this.sep + s;
        this.cells = newCells(BM.T_ROCK);
        carve(this.cells, a, this.gapW);
        carve(this.cells, b, this.gapW);
        this.gapX = a;
      };
      layer.hint = '二重';
      layer.exit = [layer.mid - layer.sep - layer.amp, layer.mid + layer.sep + layer.amp];
    },

    /* 岩に爆弾が埋まっている。穴は狭いが、撃ち抜けば大穴とボーナス */
    bombrock: function (layer, cfg) {
      layer.cells = newCells(BM.T_ROCK);
      // 以前はここが 1 固定で、深度に関わらず最難関の幅になっていた
      var bw = Math.max(2, cfg.gapW - 1);
      carve(layer.cells, layer.gapX, bw);
      var spots = BM.shuffle([L + 1, L + 3, L + 5, R - 5, R - 3, R - 1])
        .filter(function (c) { return Math.abs(c - layer.gapX) > 1; })
        .slice(0, BM.randInt(2, 3));
      for (var i = 0; i < spots.length; i++) layer.cells[spots[i]] = BM.T_BOMB;
      layer.hint = '誘爆';
      var bh = (bw - 1) / 2;
      layer.exit = [layer.gapX - bh, layer.gapX + bh];
    }
  };

  /* 深度ごとの出現テーブル */
  function typeTable(rows) {
    var t = [['gap', 40], ['twin', 18], ['crack', 14]];
    if (rows > 18) t.push(['crackmix', 14]);
    if (rows > 28) t.push(['shutter', 16]);
    if (rows > 45) t.push(['button', 13]);
    if (rows > 70) t.push(['gate', 14]);
    if (rows > 95) t.push(['bombrock', 12]);
    if (rows > 125) t.push(['spinner', 13]);
    return t;
  }

  function pickType(rows, lastType) {
    var t = typeTable(rows).filter(function (e) { return e[0] !== lastType; });
    var sum = 0, i;
    for (i = 0; i < t.length; i++) sum += t[i][1];
    var r = Math.random() * sum;
    for (i = 0; i < t.length; i++) { r -= t[i][1]; if (r <= 0) return t[i][0]; }
    return 'gap';
  }

  /* =========================================================
     World
     ========================================================= */
  function World() {
    this.reset();
  }

  World.prototype.reset = function () {
    this.layers = [];
    this.byRow = {};
    this.nextRow = 12;      // 最初の数行は何も無い（落ち始める助走）
    this.exit = { lo: 7, hi: 7 };   // 直前の層を抜けたあと居られる列の範囲
    this.exitFree = false;          // その範囲を自分で選べたか（もろい岩・動く穴）
    this.lastType = '';
    this.t = 0;
    this.deepest = 0;
  };

  World.prototype.vTerm = function (rows) {
    return BM.lerp(BM.V_TERM_BASE, BM.V_TERM_MAX, BM.clamp(rows / 400, 0, 1));
  };

  /* 難易度は「行数」ではなく「時間」で定義する。
     落下速度は深度で上がるので、行数を一定に詰めていくと層と層の間の
     時間が一気に潰れる（以前は 1.09秒 → 0.32秒 まで縮み、その間に横へ
     動けるのが 1.86 マスしかなかった。穴の幅は 1 マスなのに）。
     時間で決めれば、速くなるぶん行間は自然に広がる。 */
  World.prototype.difficulty = function (rows) {
    var k = BM.clamp(rows / 300, 0, 1);
    var vt = this.vTerm(rows);
    var gapTime = BM.lerp(BM.LAYER_TIME_START, BM.LAYER_TIME_MIN, k);
    return {
      gapTime: gapTime,
      spacing: Math.max(5, Math.round(gapTime * vt / TILE)),
      // 当たり判定が 24px なので、1マス(40px)の穴は許容 ±8px しかない。
      // 落下を止められない以上これは詰みなので、2マスを下限にする。
      gapW: Math.max(2, Math.round(BM.lerp(3.4, 2.0, k)))
    };
  };

  /* untilRow まで地層を用意する */
  World.prototype.ensure = function (untilRow) {
    var guard = 0;
    while (this.nextRow <= untilRow && guard++ < 400) {
      var rows = this.nextRow;
      var cfg = this.difficulty(rows);
      cfg.vTerm = this.vTerm(rows);
      // debugType はテスト専用。1種類の地層だけを並べて通れるか確かめるのに使う
      var type = this.debugType || pickType(rows, this.lastType);

      // ボタン層だけは、ボタンへ横移動が間に合う落差を「置く前に」確保する。
      // 層の後ろで間隔を足しても、そのボタンには届かない。
      if (type === 'button') {
        // 出口の範囲のどこから来ても、近いほうの壁へ届く落差を確保する
        var bneed = 0;
        for (var bx = Math.floor(this.exit.lo); bx <= Math.ceil(this.exit.hi); bx++) {
          bneed = Math.max(bneed, Math.min(Math.abs(bx - L), Math.abs(bx - R)));
        }
        cfg.buttonOffset = 4;
        var needRows = Math.ceil(bneed * cfg.vTerm / (BM.MOVE_SPEED * BM.REACH_MARGIN)) + cfg.buttonOffset + 2;
        if (needRows > cfg.spacing) {
          rows += needRows - cfg.spacing;
          this.nextRow = rows;
          cfg.spacing = needRows;
        }
      }

      var layer = {
        row: rows,
        type: type,
        t: 0,
        phase: BM.rand(0, 6.28),
        cells: null,
        gapX: 7,
        button: null,
        dynamic: false,
        hint: '',
        item: null,
        passed: false
      };

      // 直前の層の出口から横移動が間に合う範囲にだけ次の穴を置く。
      //   出口が固定の層（穴・ボタンなど）→ 出口の端から端まで全部届く範囲（厳しい側）
      //   出口が自由な層（もろい岩・動く穴）→ 好きな場所で抜けられるので緩い側
      // 出口の性質で自動的に切り替わるように、狭いほうが空なら広いほうを使う。
      var reach = reachTiles(cfg.spacing, cfg.vTerm);

      // 出口の幅が広い層（動く穴・二又など）のあとは、その端から端まで
      // 届くだけの落差が要る。足りなければ、次の層を置く前に落差を伸ばす。
      // これをやらないと「どちらの出口を選んだかで詰む」配置が生まれる。
      if (!this.exitFree) {
        var minReach = (this.exit.hi - this.exit.lo) / 2 + 0.5;
        if (reach < minReach) {
          var needRows = Math.ceil(minReach * cfg.vTerm / (BM.MOVE_SPEED * BM.REACH_MARGIN));
          rows += needRows - cfg.spacing;
          this.nextRow = rows;
          layer.row = rows;
          cfg.spacing = needRows;
          reach = reachTiles(cfg.spacing, cfg.vTerm);
        }
      }

      var lo, hi;
      if (this.exitFree) {
        // 直前の層はどこでも抜けられた＝好きな位置に構えられる
        lo = Math.ceil(this.exit.lo - reach);
        hi = Math.floor(this.exit.hi + reach);
      } else {
        // 出口が決まっていた＝その範囲のどこから出ても届く位置に限る
        lo = Math.ceil(this.exit.hi - reach);
        hi = Math.floor(this.exit.lo + reach);
      }
      lo = Math.max(L + 1, lo);
      hi = Math.min(R - 1, hi);
      if (lo > hi) lo = hi = BM.clamp(Math.round((this.exit.lo + this.exit.hi) / 2), L + 1, R - 1);
      layer.gapX = BM.randInt(lo, hi);
      layer.exit = [layer.gapX, layer.gapX];
      cfg.allowedLo = lo; cfg.allowedHi = hi;

      BUILDERS[type](layer, cfg, { lo: this.exit.lo, hi: this.exit.hi });

      // ときどきアイテムを浮かべる
      if (Math.random() < 0.3) {
        var pool = ['BOMB', 'BOMB', 'POWER', 'SHIELD', 'SLOW'];
        layer.item = {
          col: BM.clamp(layer.gapX + BM.randInt(-1, 1), L, R),
          row: layer.row - BM.randInt(2, 4),
          type: BM.pick(pool),
          t: 0,
          alive: true
        };
      }

      this.layers.push(layer);
      this.byRow[layer.row] = layer;

      this.exit = {
        lo: BM.clamp(layer.exit[0], L, R),
        hi: BM.clamp(layer.exit[1], L, R)
      };
      this.exitFree = !!layer.exitFree;
      this.lastType = type;
      this.nextRow += cfg.spacing + (layer.extraRows || 0);
      this.deepest = layer.row;
    }
  };

  World.prototype.update = function (dt) {
    this.t += dt;
    for (var i = 0; i < this.layers.length; i++) {
      var l = this.layers[i];
      l.t += dt;
      if (l.dynamic && l.refresh) l.refresh(l.t + l.phase);
    }
  };

  World.prototype.layerAt = function (row) {
    return this.byRow[row] || null;
  };

  World.prototype.tileAt = function (col, row) {
    if (col < L || col > R) return BM.T_ROCK;         // 縦坑の壁
    var l = this.byRow[row];
    if (!l || l.row !== row || !l.cells) return BM.T_EMPTY;
    return l.cells[col];
  };

  World.prototype.setTile = function (col, row, v) {
    if (col < L || col > R) return;
    var l = this.byRow[row];
    if (!l || l.row !== row || !l.cells) return;
    l.cells[col] = v;
  };

  /* 画面より十分上に流れた地層を捨てる */
  World.prototype.prune = function (aboveRow) {
    if (this.layers.length < 40) return;
    var kept = [];
    for (var i = 0; i < this.layers.length; i++) {
      var l = this.layers[i];
      if (l.row < aboveRow - 6) {
        delete this.byRow[l.row];
      } else kept.push(l);
    }
    this.layers = kept;
  };

  BM.World = World;
  BM.reachTiles = reachTiles;
})(BM);
