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

  GameMap.prototype.isBorder = function (cx, cy) {
    return cx === 0 || cy === 0 || cx === this.w - 1 || cy === this.h - 1;
  };

  /* =========================================================
     柱の生成
     -------------------------------------------------------
     原典の「偶数マスに1マスの柱が等間隔」という格子はやめて、
     数種類の形をした岩塊を点対称に配置する。ただし格子が保証していた
     遊びやすさは壊せないので、次の3つを生成後に検査して満たすまで直す。

       1. 通路は必ず1マス幅以上 … 岩塊どうしを8近傍で離して置く
       2. 全マスが行き来できる   … 塗りゲーなので孤島があると成立しない
       3. どのマスに爆弾を置いても逃げられる
          … そのマスから3歩以内に「行も列も違うマス」があること。
            爆風は十字にしか伸びないので、これが満たされれば必ず躱せる。

     点対称にしているのは対戦の公平性のためと、乱数の塊ではなく
     設計された盤面に見せるため。
     ========================================================= */

  var PILLAR_SHAPES = [
    [[0, 0]],
    [[0, 0], [1, 0]],
    [[0, 0], [0, 1]],
    [[0, 0], [1, 0], [0, 1]],
    [[0, 0], [1, 0], [1, 1]],
    [[0, 0], [1, 0], [2, 0]],
    [[0, 0], [0, 1], [0, 2]],
    [[0, 0], [1, 0], [2, 0], [2, 1]]
  ];

  GameMap.prototype._resetTiles = function () {
    for (var y = 0; y < this.h; y++) {
      for (var x = 0; x < this.w; x++) {
        var i = y * this.w + x;
        this.tiles[i] = this.isBorder(x, y) ? BM.T_WALL : BM.T_EMPTY;
        this.decor[i] = Math.random();
        this.ink[i] = BM.INK_NONE;
        this.inkT[i] = 1;
      }
    }
  };

  /* 岩塊どうしが 8 近傍で触れないか（＝通路が必ず1マス残るか） */
  GameMap.prototype._roomFor = function (cells, safe) {
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (c.x < 1 || c.y < 1 || c.x > this.w - 2 || c.y > this.h - 2) return false;
      if (safe[BM.key(c.x, c.y)]) return false;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var nx = c.x + dx, ny = c.y + dy;
          if (this.isBorder(nx, ny)) continue;
          if (this.at(nx, ny) === BM.T_WALL) return false;
        }
      }
    }
    return true;
  };

  /* 到達できる床の数（孤島の検出用） */
  GameMap.prototype._reachCount = function (sx, sy) {
    var seen = new Uint8Array(this.w * this.h);
    var stack = [sy * this.w + sx];
    seen[sy * this.w + sx] = 1;
    var n = 0;
    while (stack.length) {
      var cur = stack.pop(); n++;
      var cx = cur % this.w, cy = (cur / this.w) | 0;
      for (var d = 0; d < 4; d++) {
        var nx = cx + BM.DIRS[d].x, ny = cy + BM.DIRS[d].y;
        var ni = ny * this.w + nx;
        if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
        if (seen[ni] || this.tiles[ni] === BM.T_WALL) continue;
        seen[ni] = 1; stack.push(ni);
      }
    }
    return n;
  };

  GameMap.prototype._floorCount = function () {
    var n = 0;
    for (var i = 0; i < this.tiles.length; i++) if (this.tiles[i] !== BM.T_WALL) n++;
    return n;
  };

  /* 爆弾を置いたら詰むマス（3歩以内に行も列も違うマスが無い）を列挙 */
  GameMap.prototype._trapCells = function () {
    var traps = [];
    for (var y = 1; y < this.h - 1; y++) {
      for (var x = 1; x < this.w - 1; x++) {
        if (this.at(x, y) === BM.T_WALL) continue;
        if (!this._hasShelter(x, y)) traps.push({ x: x, y: y });
      }
    }
    return traps;
  };

  GameMap.prototype._hasShelter = function (sx, sy) {
    var seen = {};
    var frontier = [{ x: sx, y: sy, d: 0 }];
    seen[BM.key(sx, sy)] = true;
    while (frontier.length) {
      var c = frontier.shift();
      if (c.x !== sx && c.y !== sy) return true;   // 十字の外に出られた
      if (c.d >= 3) continue;
      for (var d = 0; d < 4; d++) {
        var nx = c.x + BM.DIRS[d].x, ny = c.y + BM.DIRS[d].y;
        if (this.at(nx, ny) === BM.T_WALL) continue;
        if (seen[BM.key(nx, ny)]) continue;
        seen[BM.key(nx, ny)] = true;
        frontier.push({ x: nx, y: ny, d: c.d + 1 });
      }
    }
    return false;
  };

  GameMap.prototype._layPillars = function (safe, target) {
    var placed = 0, guard = 0;
    while (placed < target && guard++ < 900) {
      var shape = BM.pick(PILLAR_SHAPES);
      var ax = BM.randInt(1, this.w - 2), ay = BM.randInt(1, this.h - 2);
      var cells = [], i;
      for (i = 0; i < shape.length; i++) cells.push({ x: ax + shape[i][0], y: ay + shape[i][1] });
      // 180度回転した位置にも同じ形を置いて点対称にする
      var mirror = [];
      for (i = 0; i < cells.length; i++) mirror.push({ x: this.w - 1 - cells[i].x, y: this.h - 1 - cells[i].y });

      var all = cells.concat(mirror);
      var overlaps = false;
      for (i = 0; i < cells.length && !overlaps; i++)
        for (var j = 0; j < mirror.length; j++)
          if (cells[i].x === mirror[j].x && cells[i].y === mirror[j].y) { overlaps = true; break; }
      if (overlaps) continue;
      if (!this._roomFor(all, safe)) continue;

      for (i = 0; i < all.length; i++) this.set(all[i].x, all[i].y, BM.T_WALL);
      placed += all.length;
    }
    return placed;
  };

  /* spawnClear: 開始地点まわりを空けるセルの配列 */
  GameMap.prototype.generate = function (density, spawnClear) {
    var i, x, y;
    var safe = {};
    for (i = 0; i < spawnClear.length; i++) safe[BM.key(spawnClear[i].x, spawnClear[i].y)] = true;

    var attempt = 0;
    for (;;) {
      attempt++;
      this._resetTiles();
      this._layPillars(safe, 30);

      // 逃げ場の無いマスは、隣の柱を1マス削って開ける
      var repair = 0;
      for (;;) {
        var traps = this._trapCells();
        if (!traps.length || repair++ > 60) break;
        var t = BM.pick(traps);
        var opened = false;
        var dirs = BM.shuffle(BM.DIRS.slice());
        for (i = 0; i < dirs.length; i++) {
          var nx = t.x + dirs[i].x, ny = t.y + dirs[i].y;
          if (this.isBorder(nx, ny)) continue;
          if (this.at(nx, ny) !== BM.T_WALL) continue;
          this.set(nx, ny, BM.T_EMPTY);
          opened = true;
          break;
        }
        if (!opened) break;
      }

      var ok = this._trapCells().length === 0 &&
               this._reachCount(spawnClear.length ? spawnClear[0].x : 1,
                                spawnClear.length ? spawnClear[0].y : 1) === this._floorCount();
      if (ok || attempt >= 25) break;
    }

    this.paintable = this._floorCount();

    // ソフトブロック
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
