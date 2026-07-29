/* =========================================================
   BLAST RUSH — ステージ生成 / グリッド探索
   ========================================================= */
(function (BM) {
  'use strict';

  function GameMap() {
    this.w = BM.COLS;
    this.h = BM.ROWS;
    this.tiles = new Uint8Array(this.w * this.h);
    this.ink = new Uint8Array(this.w * this.h);       // 0=中立 / 1=1P / 2=2P・敵
    this.inkT = new Float32Array(this.w * this.h);    // 塗られてからの経過（にじみアニメ）
    this.decor = new Float32Array(this.w * this.h);   // 見た目のバリエーション
    this.paintable = 0;                               // 壁以外のマス数（分母）
  }

  /* ---------- インク ---------- */
  GameMap.prototype.inkAt = function (cx, cy) {
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return BM.INK_NONE;
    return this.ink[cy * this.w + cx];
  };

  /* 塗れたら true。壁とソフトブロックの上は塗れない。 */
  GameMap.prototype.paint = function (cx, cy, team) {
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return false;
    var i = cy * this.w + cx;
    if (this.tiles[i] !== BM.T_EMPTY) return false;
    var was = this.ink[i];
    this.ink[i] = team;
    this.inkT[i] = 0;
    return was !== team;
  };

  GameMap.prototype.inkCounts = function () {
    var a = 0, b = 0;
    for (var i = 0; i < this.ink.length; i++) {
      if (this.tiles[i] === BM.T_WALL) continue;
      if (this.ink[i] === 1) a++;
      else if (this.ink[i] === 2) b++;
    }
    return { 1: a, 2: b, total: this.paintable };
  };

  GameMap.prototype.ratio = function (team) {
    if (!this.paintable) return 0;
    return this.inkCounts()[team] / this.paintable;
  };

  GameMap.prototype.tickInk = function (dt) {
    for (var i = 0; i < this.inkT.length; i++) {
      if (this.inkT[i] < 1) this.inkT[i] += dt;
    }
  };

  GameMap.prototype.at = function (cx, cy) {
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return BM.T_WALL;
    return this.tiles[cy * this.w + cx];
  };
  GameMap.prototype.set = function (cx, cy, v) {
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return;
    this.tiles[cy * this.w + cx] = v;
  };
  GameMap.prototype.isWall = function (cx, cy) { return this.at(cx, cy) === BM.T_WALL; };
  GameMap.prototype.isBlock = function (cx, cy) { return this.at(cx, cy) === BM.T_BLOCK; };
  GameMap.prototype.isOpen = function (cx, cy) { return this.at(cx, cy) === BM.T_EMPTY; };

  GameMap.prototype.isFixedWall = function (cx, cy) {
    return cx === 0 || cy === 0 || cx === this.w - 1 || cy === this.h - 1 ||
           (cx % 2 === 0 && cy % 2 === 0);
  };

  /* spawnClear: 開始地点まわりを空けるセルの配列 */
  GameMap.prototype.generate = function (density, spawnClear) {
    var x, y, i;
    this.paintable = 0;
    for (y = 0; y < this.h; y++) {
      for (x = 0; x < this.w; x++) {
        i = y * this.w + x;
        this.tiles[i] = this.isFixedWall(x, y) ? BM.T_WALL : BM.T_EMPTY;
        this.decor[i] = Math.random();
        this.ink[i] = BM.INK_NONE;
        this.inkT[i] = 1;
        if (this.tiles[i] !== BM.T_WALL) this.paintable++;
      }
    }
    var safe = {};
    for (i = 0; i < spawnClear.length; i++) safe[BM.key(spawnClear[i].x, spawnClear[i].y)] = true;

    for (y = 1; y < this.h - 1; y++) {
      for (x = 1; x < this.w - 1; x++) {
        if (this.at(x, y) !== BM.T_EMPTY) continue;
        if (safe[BM.key(x, y)]) continue;
        if (Math.random() < density) this.set(x, y, BM.T_BLOCK);
      }
    }
  };

  GameMap.prototype.freeCells = function (includeBlocks) {
    var out = [];
    for (var y = 1; y < this.h - 1; y++) {
      for (var x = 1; x < this.w - 1; x++) {
        var t = this.at(x, y);
        if (t === BM.T_EMPTY || (includeBlocks && t === BM.T_BLOCK)) out.push({ x: x, y: y });
      }
    }
    return out;
  };

  GameMap.prototype.blockCells = function () {
    var out = [];
    for (var y = 1; y < this.h - 1; y++)
      for (var x = 1; x < this.w - 1; x++)
        if (this.at(x, y) === BM.T_BLOCK) out.push({ x: x, y: y });
    return out;
  };

  /* -------------------------------------------------------
     BFS。passable(cx,cy) が true のセルだけ通れる。
     goal(cx,cy) を満たす最寄りセルへの「最初の一歩」を返す。
     ------------------------------------------------------- */
  GameMap.prototype.bfsStep = function (sx, sy, goal, passable, maxDepth) {
    var W = this.w, H = this.h;
    var total = W * H;
    var prev = new Int32Array(total).fill(-1);
    var seen = new Uint8Array(total);
    var queue = [sy * W + sx];
    seen[sy * W + sx] = 1;
    var depth = new Uint16Array(total);
    var head = 0;
    var found = -1;

    while (head < queue.length) {
      var cur = queue[head++];
      var cx = cur % W, cy = (cur / W) | 0;
      if (!(cx === sx && cy === sy) && goal(cx, cy)) { found = cur; break; }
      if (maxDepth && depth[cur] >= maxDepth) continue;
      for (var d = 0; d < 4; d++) {
        var nx = cx + BM.DIRS[d].x, ny = cy + BM.DIRS[d].y;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        var ni = ny * W + nx;
        if (seen[ni]) continue;
        if (!passable(nx, ny)) continue;
        seen[ni] = 1;
        prev[ni] = cur;
        depth[ni] = depth[cur] + 1;
        queue.push(ni);
      }
    }
    if (found < 0) return null;

    // 経路を戻って最初の一歩を得る
    var node = found;
    var start = sy * W + sx;
    var guard = 0;
    while (prev[node] !== start && prev[node] !== -1 && guard++ < total) node = prev[node];
    if (prev[node] === -1) return null;
    return { x: node % W, y: (node / W) | 0, dist: depth[found] };
  };

  BM.GameMap = GameMap;

  /* =========================================================
     ステージ定義
     ========================================================= */
  BM.stageDef = function (n) {
    var wave = Math.min(n, 12);
    var density = BM.clamp(0.36 + wave * 0.012, 0.36, 0.5);
    var count = 3 + Math.floor((n + 1) / 2);
    var types = [];

    // 序盤はゆるい敵、進むほど賢い敵が混ざる
    var i;
    for (i = 0; i < count; i++) {
      var r = Math.random();
      if (n <= 1) types.push('balloon');
      else if (n <= 3) types.push(r < 0.65 ? 'balloon' : 'chaser');
      else if (n <= 5) types.push(r < 0.4 ? 'balloon' : (r < 0.8 ? 'chaser' : 'ghost'));
      else if (n <= 8) types.push(r < 0.25 ? 'balloon' : (r < 0.6 ? 'chaser' : (r < 0.82 ? 'ghost' : 'bomber')));
      else types.push(r < 0.15 ? 'balloon' : (r < 0.5 ? 'chaser' : (r < 0.75 ? 'ghost' : 'bomber')));
    }
    return {
      stage: n,
      density: density,
      enemies: types,
      time: Math.max(120, 210 - n * 5),
      itemChance: BM.clamp(0.34 - n * 0.008, 0.2, 0.34)
    };
  };
})(BM);
