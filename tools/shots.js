/* =========================================================
   DEEP FALL — 投稿用スクリーンショットの作成
     node tools/shots.js   →  dist/press/

   ゲーム投稿サイトはスクリーンショットを求めてくる。
   手で撮ると「たまたまその瞬間だった絵」になるので、
   見せたい場面を指定して毎回同じものを撮れるようにしておく。

   撮るのは4枚。それぞれ「何を伝える絵か」を決めてある。
     01 タイトル        … 何のゲームか
     02 落下中          … 遊んでいる絵。落下予測線と地層が見える
     03 ご褒美の間      … 200m ごとの見返り
     04 誘爆            … 爆発の派手さ
   ========================================================= */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'press');
const PORT = 8952;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(PORT, () => resolve(srv));
  });
}

function chromiumPath() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!fs.existsSync(base)) return undefined;
  const dir = fs.readdirSync(base).find(d => /^chromium-\d+$/.test(d));
  return dir ? path.join(base, dir, 'chrome-linux', 'chrome') : undefined;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await chromium.launch(chromiumPath() ? { executablePath: chromiumPath() } : {});
  // 2倍で撮る。縮小されることはあっても、荒い絵を引き伸ばされることはない
  const page = await browser.newPage({ viewport: { width: 720, height: 820 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  /* 撮る前に画面を掃除する。
     開発用の表示（構造確認モードのバッジ）や、前の場面で出したままの
     トーストが写り込むと、そのまま店頭に並ぶ絵になってしまう。 */
  const clean = async (keep) => {
    await page.evaluate(k => {
      BM.game.noDeath = false;
      if (!k.toast) {
        const t = document.getElementById('reward-toast');
        if (t) { t.classList.remove('show'); t.style.opacity = '0'; }
      }
      if (!k.banner) {
        const b = document.getElementById('combo-banner');
        if (b) { b.classList.remove('show'); b.style.opacity = '0'; }
      }
      BM.game.render();
    }, keep || {});
  };

  const shot = async (name, keep) => {
    await clean(keep);
    await page.waitForTimeout(120);
    await page.locator('#stage-wrap').screenshot({ path: path.join(OUT, name) });
    console.log('  ' + name);
  };

  await page.goto(`http://localhost:${PORT}/index.html?noads=1`);
  await page.waitForTimeout(600);

  console.log('撮影:');
  await shot('01-title.png');

  // --- 02 落下中。自動操縦で少し潜らせてから撮る ---
  await page.evaluate(() => {
    BM.autopilot.enabled = true; BM.ads.enabled = false;
    BM.game.newRun(); BM.ui.hide();
  });
  await page.waitForTimeout(7000);
  /* 層と層の中間で撮ると、ただの空間の絵になる。
     次の層の手前まで進めてから止める（落下予測線が岩を指す絵になる）。 */
  await page.evaluate(() => {
    const g = BM.game;
    for (let i = 0; i < 900; i++) {
      const next = g.world.layers
        .filter(l => l.row * BM.TILE > g.player.y + 40)
        .sort((a, b) => a.row - b.row)[0];
      if (next) {
        const d = next.row * BM.TILE - g.player.y;
        if (d < 230 && d > 150) break;
      }
      g.update(1 / 120);
    }
    g.render();
    g.state = BM.S_PAUSE;
  });
  await shot('02-play.png');

  // --- 03 ご褒美の間（宝物庫。結晶が並んでいる絵） ---
  await page.evaluate(() => {
    const g = BM.game;
    g.state = BM.S_PLAY;
    g.newRun(); BM.ui.hide(); g.noDeath = true;
    const row = 400 - 14;
    g.player.y = row * BM.TILE; g.player.deepest = row;
    g.camY = g.player.y - BM.VIEW_H * 0.3;
    g.world.reset();
    g.world.nextRow = row - 12; g.world.lastRow = row - 12;
    g.world.mileDone = Math.floor(400 / BM.MILESTONE_ROWS) - 1;
    g.world.ensure(row + 90);
    g.zoneIndex = Math.min(BM.ZONES.length - 1, Math.floor(row / BM.ZONE_ROWS));
  });
  for (let i = 0; i < 90; i++) {
    const hit = await page.evaluate(() => {
      for (let k = 0; k < 24; k++) BM.game.update(1 / 120);
      BM.game.render();
      return !!BM.game.reward;
    });
    if (hit) break;
  }
  await page.evaluate(() => {
    for (let k = 0; k < 70; k++) BM.game.update(1 / 120);
    BM.game.render();
    BM.game.state = BM.S_PAUSE;
  });
  await shot('03-reward.png', { toast: true });   // 何の部屋かを説明しているので残す

  // --- 04 誘爆。埋まった爆弾の層に自分の爆弾を当てる ---
  await page.evaluate(() => {
    const g = BM.game;
    g.state = BM.S_PLAY;
    BM.autopilot.enabled = false;
    g.newRun(); BM.ui.hide(); g.noDeath = true;
    /* 深度の数字だけ差し替えると、右の深度目盛りが 0m のままになって食い違う。
       実際にその深さへ置いてから作る。 */
    const at = 318;
    g.player.y = at * BM.TILE; g.player.deepest = at;
    g.camY = g.player.y - BM.VIEW_H * 0.3;
    g.world.reset();
    g.world.nextRow = at + 40; g.world.lastRow = at;
    g.world.mileDone = Math.floor(at / BM.MILESTONE_ROWS);
    g.world.ensure(at + 60);
    g.zoneIndex = Math.min(BM.ZONES.length - 1, Math.floor(at / BM.ZONE_ROWS));
    // 目の前に埋まった爆弾を並べた層を作る
    const row = BM.rowOf(g.player.y) + 7;
    const cells = new Uint8Array(BM.COLS).fill(BM.T_ROCK);
    for (let c = BM.PLAY_L; c <= BM.PLAY_R; c++) {
      if (Math.abs(c - 7) % 2 === 0) cells[c] = BM.T_BOMB;
    }
    cells[7] = BM.T_EMPTY;
    const l = { row, type: 'bombrock', cells, gapX: 7, t: 0, phase: 0,
                exit: [7, 7], passed: false, items: [], button: null, dynamic: false };
    g.world.layers.push(l); g.world.byRow[row] = l;
    g.player.power = 4;
    g.score = 4820;
    BM.ui.syncHud(g);
    g.blast(7, row, 4, false);
    for (let k = 0; k < 14; k++) g.update(1 / 120);   // 連鎖が広がった瞬間
    g.render();
    g.state = BM.S_PAUSE;
  });
  await shot('04-blast.png', { banner: true });   // 連鎖のバナーは実際に出る演出なので残す

  /* --- カバー画像 ---
     一覧に最初に出る1枚。遊んでいる場面と違い、横長で
     「何のゲームか」が一目で分かる必要がある。
     縦長の画面写真をカバーに使うと、一覧の枠で上下が切れる。 */
  await page.setViewportSize({ width: 960, height: 504 });   // dpr2 → 1920x1008
  await page.evaluate(() => {
    const g = BM.game;
    g.state = BM.S_PLAY;
    BM.autopilot.enabled = true; BM.ads.enabled = false;
    g.newRun(); BM.ui.hide();
  });
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    const g = BM.game;
    // 岩が画面に入っている瞬間で止める（空だけの絵にしない）
    for (let i = 0; i < 900; i++) {
      const next = g.world.layers
        .filter(l => l.row * BM.TILE > g.player.y + 40)
        .sort((a, b) => a.row - b.row)[0];
      if (next) {
        const d = next.row * BM.TILE - g.player.y;
        if (d < 260 && d > 170) break;
      }
      g.update(1 / 120);
    }
    g.render();
    g.state = BM.S_PAUSE;

    const app = document.getElementById('app');
    const cover = document.createElement('div');
    cover.id = 'cover';
    cover.innerHTML =
      '<div class="cv-text">' +
      '  <div class="cv-title">DEEP FALL</div>' +
      '  <div class="cv-sub">落ち続けろ。<b>止まった時が終わり。</b></div>' +
      '  <div class="cv-body">爆弾で足元を掘りながら、どこまでも下へ。<br>' +
      '  地面に触れた瞬間に終わり。止まることは許されていない。</div>' +
      '  <div class="cv-tags"><span>9種の突破口</span><span>200mごとのご褒美</span>' +
      '<span>深さに終わりなし</span></div>' +
      '</div>';
    document.body.appendChild(cover);
    cover.appendChild(app);

    const css = document.createElement('style');
    css.textContent = `
      body{overflow:hidden}
      #cover{
        position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
        gap:44px;padding:0 56px;
        background:
          radial-gradient(900px 600px at 18% 40%, #2a1a45 0%, transparent 62%),
          radial-gradient(700px 500px at 92% 105%, #3a1030 0%, transparent 60%),
          #0a0710;
      }
      #cover #app{width:342px;flex:0 0 auto;margin:0}
      #cover #legend{display:none}
      .cv-text{max-width:520px}
      .cv-title{
        font-size:76px;font-weight:900;letter-spacing:.05em;line-height:1;
        background:linear-gradient(180deg,#fff3c4,#ffd23d 45%,#ff6a3d);
        -webkit-background-clip:text;background-clip:text;color:transparent;
        filter:drop-shadow(0 6px 26px rgba(255,106,61,.55));
      }
      .cv-sub{font-size:22px;font-weight:700;color:#f4ecff;margin-top:14px;line-height:1.5}
      .cv-sub b{color:#ff8a6a}
      .cv-body{font-size:14.5px;line-height:1.9;color:#9a86c4;margin-top:14px}
      .cv-tags{display:flex;gap:8px;margin-top:20px;flex-wrap:wrap}
      .cv-tags span{
        font-size:12px;font-weight:800;color:#ffe9a8;
        border:1px solid rgba(255,210,61,.45);border-radius:999px;padding:5px 13px;
      }`;
    document.head.appendChild(css);
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, '00-cover.png') });
  console.log('  00-cover.png');

  await browser.close();
  srv.close();

  /* 投稿先の画像要件（GAMEYARD の手引きに書かれているもの）を、
     出した直後にここで確かめる。上げてから弾かれると往復が増える。
       ・PNG / JPG / WebP
       ・1枚 3MB まで
       ・最小 600×315、最大 4096×4096 */
  const MIN_W = 600, MIN_H = 315, MAX_WH = 4096, MAX_MB = 3;
  const files = fs.readdirSync(OUT).sort();
  console.log(`\ndist/press/ に ${files.length} 枚`);
  let bad = 0;
  files.forEach(f => {
    const buf = fs.readFileSync(path.join(OUT, f));
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);   // PNG のヘッダ
    const mb = buf.length / 1024 / 1024;
    const ng = [];
    if (w < MIN_W || h < MIN_H) ng.push(`小さすぎる(最小 ${MIN_W}x${MIN_H})`);
    if (w > MAX_WH || h > MAX_WH) ng.push(`大きすぎる(最大 ${MAX_WH})`);
    if (mb > MAX_MB) ng.push(`重すぎる(最大 ${MAX_MB}MB)`);
    if (ng.length) bad++;
    console.log(`  ${f}  ${w}x${h}  ${mb.toFixed(2)}MB  ${ng.length ? '★' + ng.join(' ') : 'OK'}`);
  });
  if (bad) { console.log(`\n★ ${bad} 枚が投稿先の画像要件を満たしていません`); process.exit(1); }
  if (errors.length) { console.log('ERRORS:', errors.slice(0, 3)); process.exit(1); }
})();
