/* =========================================================
   DEEP FALL — 自動操縦

   本来はテスト用に書いたもの。
   「操作は苦手だけど構造が最後まで大丈夫か見たい」という用途に、
   そのまま観戦モードとして本体に載せている。

   テストと本体で同じコードを使うのが肝心。
   検査に通ったのが「出荷される操縦」でないと意味がない。

   考え方：
     ・2層先まで見る（人間が画面で見えている範囲と同じ）
     ・動く穴は「自分が着く時刻」の位置を予測して先回りする
     ・横は位置ではなく速度を制御する（そうしないと狭い穴で行き過ぎる）
     ・抜け道が無ければ爆弾を落として掘る
   ========================================================= */
(function (BM) {
  'use strict';

  var L = BM.PLAY_L, R = BM.PLAY_R, TILE = BM.TILE;

  function passable(l, c) {
    if (!l || !l.cells) return true;
    var t = l.cells[c];
    return t !== BM.T_ROCK && t !== BM.T_BOMB;
  }

  /* 通り抜けられる帯の中心を列挙する。端ではなく中心を狙わないと、
     閉じてくる穴で削られて死ぬ。 */
  function runs(l) {
    var out = [], run = [];
    for (var c = L; c <= R + 1; c++) {
      if (c <= R && passable(l, c)) run.push(c);
      else if (run.length) { out.push(BM.centerX((run[0] + run[run.length - 1]) / 2)); run = []; }
    }
    return out;
  }

  function options(game, l, lead) {
    if (l.buttons) {
      var hit = l.buttons.filter(function (b) { return b.hit; });
      if (hit.length) {
        // 押した後は、もう片方のボタンではなく開きつつある穴へ向かう
        var open = runs(l);
        if (open.length) return open;
        return [BM.centerX(l.holeCol)];
      }
      return l.buttons.map(function (b) { return game.buttonPos(b).x; });
    }
    if (l.dynamic && l.refresh && lead > 0) {
      // 到着時刻の盤面を一時的に作って評価し、必ず元に戻す
      var sc = l.cells, sg = l.gapX;
      l.refresh(l.t + l.phase + lead);
      var o = runs(l);
      l.cells = sc; l.gapX = sg;
      return o;
    }
    return runs(l);
  }

  var autopilot = {
    enabled: false,

    step: function (game) {
      var p = game.player, I = BM.input;
      I.keys['ArrowLeft'] = I.keys['ArrowRight'] = false;
      if (!p.alive || game.state !== BM.S_PLAY) return;

      // 通過し切るまでは今の層を狙い続ける。
      // 中心が隣のマスへ移った時点で次の層に切り替えると、
      // まだ体が今の層に残っているのに自分から穴を外れてしまう。
      var ahead = game.world.layers.filter(function (l) {
        return (l.row + 1) * TILE > p.y - p.r;
      }).sort(function (a, b) { return a.row - b.row; });

      var cur = ahead[0], nxt = ahead[1];
      if (!cur) return;

      var vy = Math.max(60, p.vy);
      var leadCur = Math.max(0, (cur.row * TILE - p.y) / vy);
      var opts = options(game, cur, leadCur);
      if (!opts.length) { I.just[' '] = true; return; }   // 抜け道が無ければ掘る

      var nextOpts = nxt ? options(game, nxt, Math.max(0, (nxt.row * TILE - p.y) / vy)) : null;
      var best = opts[0], bestCost = Infinity;
      for (var i = 0; i < opts.length; i++) {
        var x = opts[i];
        var cost = Math.abs(x - p.x);
        if (nextOpts && nextOpts.length) {
          var nd = Infinity;
          for (var j = 0; j < nextOpts.length; j++) nd = Math.min(nd, Math.abs(nextOpts[j] - x));
          cost += nd * 0.7;
        }
        if (cost < bestCost) { bestCost = cost; best = x; }
      }

      // 位置ではなく速度を狙う。残り距離に比例した速度に寄せると行き過ぎない
      var dx = best - p.x;
      var vmax = p.moveMax || BM.MOVE_SPEED;
      var want = BM.clamp(dx * 7, -vmax, vmax);
      if (p.vx < want - 10) I.keys['ArrowRight'] = true;
      else if (p.vx > want + 10) I.keys['ArrowLeft'] = true;
    }
  };

  BM.autopilot = autopilot;
})(BM);
