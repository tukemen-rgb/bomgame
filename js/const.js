/* =========================================================
   DEEP FALL — 定数・共通ユーティリティ

   落ち続けることだけが生きている条件。
   地面に触れた瞬間に終わり。隙間は自分でこじ開ける。
   ========================================================= */
var BM = window.BM || {};

BM.TILE = 40;
BM.COLS = 15;                 // 両端の 0 と 14 は縦坑の壁
BM.PLAY_L = 1;                // 実際に通れる左端の列
BM.PLAY_R = 13;               // 同・右端
BM.VIEW_W = BM.COLS * BM.TILE;   // 600
BM.VIEW_H = 640;                 // 16 行ぶん。先を読むために縦長にしてある
BM.VIEW_ROWS = BM.VIEW_H / BM.TILE;

/* タイル */
BM.T_EMPTY = 0;
BM.T_ROCK  = 1;   // 触れたら終わり。爆風で砕ける
BM.T_CRACK = 2;   // もろい岩。ぶつかると砕けて通り抜けられる（減速する）
BM.T_BOMB  = 3;   // 岩に埋まった爆弾。爆風で誘爆して大穴が開く

BM.isSolid = function (t) { return t === BM.T_ROCK || t === BM.T_BOMB; };
BM.blocks  = function (t) { return t !== BM.T_EMPTY; };

/* ゲーム状態 */
BM.S_TITLE = 'title';
BM.S_PLAY  = 'play';
BM.S_OVER  = 'over';
BM.S_PAUSE = 'pause';

/* ---------- 落下 ---------- */
BM.GRAVITY      = 1600;   // px/s^2
BM.V_TERM_BASE  = 330;    // 終端速度の初期値
BM.V_TERM_MAX   = 620;    // 深度で上がっていく上限
BM.DIVE_MUL     = 1.75;   // 急降下中の終端速度倍率
BM.MOVE_SPEED   = 320;    // 横移動の最高速度
BM.MOVE_ACCEL   = 3000;
BM.MOVE_FRICTION = 2400;
BM.CRACK_COST   = 0.55;   // もろい岩を砕けた直後の落下速度の残り
BM.PLAYER_R     = 12;

/* ---------- 爆弾 ---------- */
BM.BOMB_FALL_V   = 900;   // 爆弾はプレイヤーよりずっと速く落ちる
BM.BOMB_POWER    = 2;     // 爆風の長さ（マス）
BM.MAX_POWER     = 6;
BM.START_BOMBS   = 3;
BM.MAX_BOMBS     = 9;
BM.FLAME_LIFE    = 0.42;
BM.CHAIN_DELAY   = 0.055;

/* ---------- シールド ---------- */
BM.SHIELD_MAX    = 3;
BM.SHIELD_POWER  = 3;    // 発動時に開ける穴（通常の爆弾より大きい）
BM.SHIELD_IFRAME = 0.7;  // 発動直後の無敵。厚い層で複数枚消費するのを防ぐ

/* ---------- 地層 ---------- */
BM.LAYER_TIME_START = 1.15;  // 層と層の間隔（秒）。行数ではなく時間で決める
BM.LAYER_TIME_MIN   = 0.78;  // 落下が速くなるぶん、行間は自然に広がる
BM.REACH_MARGIN    = 0.72; // 横移動が間に合う距離の安全率

/* 深度で変わる地層の色。100m ごとに景色が変わる */
BM.ZONES = [
  { name: '表土',   rock: '#5b4a7a', rockDeep: '#33264d', bg1: '#1a1230', bg2: '#120c22', accent: '#9a7cc4' },
  { name: '玄武岩', rock: '#3f5a72', rockDeep: '#22384a', bg1: '#0e1c2a', bg2: '#0a1420', accent: '#6fb0d8' },
  { name: '結晶層', rock: '#6a4a7e', rockDeep: '#3b2450', bg1: '#1d1030', bg2: '#140a24', accent: '#cf8bf0' },
  { name: '熱層',   rock: '#7a4438', rockDeep: '#4a2018', bg1: '#2a1210', bg2: '#1c0c0a', accent: '#ff8a5c' },
  { name: '氷結層', rock: '#3f6e78', rockDeep: '#1f4048', bg1: '#0c2028', bg2: '#08161c', accent: '#7fe6e0' },
  { name: '深淵',   rock: '#3a3550', rockDeep: '#1c1930', bg1: '#0d0a18', bg2: '#070510', accent: '#b0a8ff' }
];
BM.ZONE_ROWS = 100;
BM.zoneAt = function (rows) {
  return BM.ZONES[Math.min(BM.ZONES.length - 1, Math.floor(rows / BM.ZONE_ROWS))];
};

/* ---------- アイテム ---------- */
BM.ITEMS = {
  BOMB:   { key: 'BOMB',   label: '爆弾 +1',   glyph: '💣', color: '#ffd9a8' },
  POWER:  { key: 'POWER',  label: '爆風アップ', glyph: '🔥', color: '#ff8a4c' },
  SHIELD: { key: 'SHIELD', label: 'シールド',   glyph: '🛡', color: '#8ce8ff' },
  SLOW:   { key: 'SLOW',   label: 'スロー',     glyph: '🌀', color: '#c9a6ff' }
};

/* ---------- 保存 ---------- */
BM.store = {
  get: function (k, fallback) {
    try {
      var v = window.localStorage.getItem(k);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  },
  set: function (k, v) {
    try { window.localStorage.setItem(k, v); } catch (e) { /* 保存できなくても遊べる */ }
  }
};

/* ---------- 汎用ヘルパ ---------- */
BM.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
BM.lerp  = function (a, b, t) { return a + (b - a) * t; };
BM.rand  = function (a, b) { return a + Math.random() * (b - a); };
BM.randInt = function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); };
BM.pick  = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
BM.shuffle = function (arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
};
BM.damp = function (a, b, lambda, dt) { return BM.lerp(a, b, 1 - Math.exp(-lambda * dt)); };

BM.colOf  = function (px) { return Math.floor(px / BM.TILE); };
BM.rowOf  = function (py) { return Math.floor(py / BM.TILE); };
BM.centerX = function (col) { return col * BM.TILE + BM.TILE / 2; };
BM.centerY = function (row) { return row * BM.TILE + BM.TILE / 2; };

BM.DIRS = [
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }
];
