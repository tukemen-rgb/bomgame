/* =========================================================
   BLAST RUSH — 定数・共通ユーティリティ
   ========================================================= */
var BM = window.BM || {};

BM.TILE = 40;
BM.COLS = 15;
BM.ROWS = 13;
BM.BOARD_W = BM.COLS * BM.TILE; // 600
BM.BOARD_H = BM.ROWS * BM.TILE; // 520

/* タイル種別 */
BM.T_EMPTY = 0; // 床
BM.T_WALL  = 1; // 硬い壁（破壊不可）
BM.T_BLOCK = 2; // ソフトブロック（破壊可）

/* ゲーム状態 */
BM.S_TITLE   = 'title';
BM.S_PLAY    = 'play';
BM.S_CLEAR   = 'clear';
BM.S_DEAD    = 'dead';     // 残機を失った瞬間の演出
BM.S_OVER    = 'over';
BM.S_PAUSE   = 'pause';
BM.S_VSROUND = 'vsround';

/* アイテム種別 */
BM.ITEMS = {
  FIRE:   { key:'FIRE',   label:'火力アップ',   glyph:'🔥', color:'#ff7a3c' },
  BOMB:   { key:'BOMB',   label:'爆弾アップ',   glyph:'💣', color:'#cfd4ff' },
  SPEED:  { key:'SPEED',  label:'スピードアップ', glyph:'⚡', color:'#ffe14d' },
  KICK:   { key:'KICK',   label:'キック',       glyph:'🦵', color:'#8affa0' },
  PIERCE: { key:'PIERCE', label:'貫通爆弾',     glyph:'✴',  color:'#ff5ce0' },
  REMOTE: { key:'REMOTE', label:'リモコン',     glyph:'📡', color:'#5ad2ff' },
  HEART:  { key:'HEART',  label:'ライフ',       glyph:'♥',  color:'#ff5470' },
  FULL:   { key:'FULL',   label:'フルファイア', glyph:'☀',  color:'#fff2a8' },
  SHIELD: { key:'SHIELD', label:'シールド',     glyph:'🛡', color:'#a0f0ff' }
};

/* バランス定数 */
BM.BOMB_FUSE     = 2.2;   // 導火線（秒）
BM.CHAIN_DELAY   = 0.055; // 誘爆までのタメ（連鎖の気持ちよさ）
BM.FLAME_LIFE    = 0.46;  // 爆風の寿命（秒）
BM.BASE_SPEED    = 118;   // px/秒
BM.SPEED_STEP    = 22;
BM.MAX_SPEED_LV  = 5;
BM.MAX_POWER     = 9;
BM.MAX_BOMBS     = 8;
BM.INVULN_TIME   = 2.4;
BM.KICK_SPEED    = 300;
BM.COMBO_WINDOW  = 1.0;

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
/* 指数的な追従（フレームレート非依存の lerp） */
BM.damp = function (a, b, lambda, dt) { return BM.lerp(a, b, 1 - Math.exp(-lambda * dt)); };

BM.cellOf  = function (px) { return Math.floor(px / BM.TILE); };
BM.centerOf = function (c) { return c * BM.TILE + BM.TILE / 2; };
BM.key = function (cx, cy) { return cy * BM.COLS + cx; };

BM.DIRS = [
  { x: 1, y: 0, name: 'right' },
  { x: -1, y: 0, name: 'left' },
  { x: 0, y: 1, name: 'down' },
  { x: 0, y: -1, name: 'up' }
];
