/* =========================================================
   DEEP FALL — 配布用 ZIP の作成
     node tools/pack.js   →  dist/deep-fall.zip

   ゲーム配信サイトへのアップロード用。多くのサイトは
   「index.html を先頭に置いた ZIP」を受け取る形なので、それに合わせる。

   中身は同梱済みの1ファイルだけ。外部通信も依存も無いので、
   これを置けばどこでもそのまま動く。

   ■ zip コマンドを使わず Node だけで書いている理由
     1. 依存を増やさない（このリポジトリは依存ゼロを保っている）
     2. 出力を毎回同じバイト列にできる。時刻を埋め込むと中身が同じでも
        ZIP が変わってしまい、dist/ をリポジトリに入れておけなくなる
   ========================================================= */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

/* ---------- CRC32 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* 時刻は固定する。作った時刻を入れると、中身が同じでも ZIP が毎回変わる。
   2020-01-01 00:00:00 を MS-DOS 形式で。 */
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

/* ---------- ZIP ---------- */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    // 圧縮して大きくなるなら無圧縮で入れる（小さいテキストで起きる）
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);   // ローカルヘッダ
    local.writeUInt16LE(20, 4);           // 展開に必要なバージョン
    local.writeUInt16LE(0, 6);            // フラグ
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);           // extra なし
    name.copy(local, 30);
    locals.push(local, body);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0); // セントラルディレクトリ
    central.writeUInt16LE(20, 4);         // 作成したバージョン
    central.writeUInt16LE(20, 6);         // 展開に必要なバージョン
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);         // extra
    central.writeUInt16LE(0, 32);         // コメント
    central.writeUInt16LE(0, 34);         // ディスク番号
    central.writeUInt16LE(0, 36);         // 内部属性
    central.writeUInt32LE(0, 38);         // 外部属性
    central.writeUInt32LE(offset, 42);    // ローカルヘッダの位置
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + body.length;
  }

  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);                    // このディスクの番号
  end.writeUInt16LE(0, 6);                    // 開始ディスク
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);                   // コメント長

  return Buffer.concat([...locals, cd, end]);
}

/* ---------- ここから作る ---------- */

// 必ずソースから作り直したものを詰める。
// 古い dist を配ると、直したはずのものが直っていない版が出回る。
require('./bundle.js');

const html = fs.readFileSync(path.join(DIST, 'deep-fall.html'));

const readme = `DEEP FALL
落ち続けろ。止まった時が終わり。

■ 遊び方
  index.html をブラウザで開くだけです。
  インストールも通信も不要で、そのまま動きます。

■ 操作
  ← →      横移動
  ↓        急降下
  Space    爆弾を落とす
  P        ポーズ
  M / N    音楽 / 効果音
  R        演出を抑える（画面揺れ・フラッシュ・色ずれを止める）

  スマホ・タブレットでは画面下にタッチボタンが出ます。
  横持ちだと縦坑が画面に入らないので、縦にしてお使いください。

■ ルール
  主人公はひたすら落下します。地面に触れた瞬間に終わりです。
  下へ抜ける道を、落ちながら作り続けてください。
  200m ごとに「ご褒美の間」があり、10000m ごとは別格です。深さに終わりはありません。

■ サイトに載せる方
  この ZIP は index.html を先頭に置いた形になっています。
  そのままアップロードしてください。

  ゲームオーバー画面の枠に、サイト内の他のゲームを出せます。
    BM.ads.promos = [
      { title: 'ゲーム名', body: '説明', cta: '遊ぶ', url: '/games/xxx' }
    ];
    BM.ads.onClick = function (promo) { /* 計測 */ };
  枠ごと消す場合は BM.ads.enabled = false;
  （有料で売る場合は、消すことをおすすめします）

■ 中身
  index.html   ゲーム本体。これ1つで完結しています
  README.txt   このファイル
`;

const buf = zip([
  // index.html は ZIP の先頭に置く（配信サイトはここを見る）
  { name: 'index.html', data: html },
  { name: 'README.txt', data: readme }
]);

fs.mkdirSync(DIST, { recursive: true });
const out = path.join(DIST, 'deep-fall.zip');
fs.writeFileSync(out, buf);
console.log('dist/deep-fall.zip  ' + (buf.length / 1024).toFixed(1) + ' KB' +
            '（index.html ' + (html.length / 1024).toFixed(1) + ' KB を圧縮）');
