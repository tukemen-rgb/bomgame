/* =========================================================
   DEEP FALL — 配布用 ZIP の確認
     node test/pack.js

   「アップロードしたら動かなかった」を防ぐのが目的。
   ZIP を作るところまでは目で見れば分かるが、
   【展開したものが本当に遊べるか】は実際に開いてみないと分からない。

   ここでやること：
     1. 標準の unzip で開けるか（自作の書き出しが規格に合っているか）
     2. index.html が ZIP の先頭にあるか（配信サイトはここを見る）
     3. 展開したものをブラウザで開いて、実際に潜れるか
     4. 外部へ通信していないか（=どこに置いても、オフラインでも動く）
     5. 2回作って同じバイト列になるか（中身が同じなら ZIP も同じ）
   ========================================================= */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ZIP = path.join(ROOT, 'dist', 'deep-fall.zip');
const PORT = 8951;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain' };

function serve(dir) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(dir, rel === '/' ? 'index.html' : rel);
      if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
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
  const errors = [];
  const check = (label, cond, detail) => {
    console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail ? '  ' + detail : ''));
    if (!cond) errors.push('ASSERT FAILED: ' + label);
  };

  /* ---- 1. 作り直しと、同じものになるか ---- */
  console.log('=== 1. ZIP を作る ===');
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'pack.js')], { stdio: 'inherit' });
  const first = fs.readFileSync(ZIP);
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'pack.js')], { stdio: 'pipe' });
  const second = fs.readFileSync(ZIP);
  console.log(`  ${(first.length / 1024).toFixed(1)} KB`);
  check('2回作っても同じバイト列になる（時刻を埋め込んでいない）', first.equals(second));

  /* ---- 2. 標準ツールで開けるか / 並び順 ---- */
  console.log('\n=== 2. 中身 ===');
  const listed = execFileSync('unzip', ['-Z1', ZIP], { encoding: 'utf8' }).trim().split('\n');
  console.log('  ' + listed.join(' / '));
  execFileSync('unzip', ['-tqq', ZIP]);   // 壊れていれば例外
  check('標準の unzip で開ける（規格に合っている）', true);
  check('index.html が先頭にある（配信サイトはここを見る）', listed[0] === 'index.html');
  check('中身が index.html と README.txt だけ',
    listed.length === 2 && listed.indexOf('README.txt') >= 0);

  /* 投稿先の制限。GAMEYARD（play-game-yard.com/upload/）が公開している要件：
       ・1作品 200MB までの zip
       ・zip 内 5,000 ファイル以内
       ・HTML5 は zip の直下に index.html
     どれも今は桁違いに余裕があるが、うっかりアセットを抱え込んだ時に
     気付けるよう、条件として書いておく。 */
  const MAX_MB = 200, MAX_FILES = 5000;
  const mb = first.length / 1024 / 1024;
  check(`投稿サイトの上限 ${MAX_MB}MB 以内（${mb.toFixed(2)}MB）`, mb <= MAX_MB);
  check(`投稿サイトの上限 ${MAX_FILES.toLocaleString('en-US')} ファイル以内（${listed.length}）`,
    listed.length <= MAX_FILES);

  /* ---- 3. 展開したものが本当に遊べるか ---- */
  console.log('\n=== 3. 展開して実際に遊ぶ ===');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deepfall-zip-'));
  execFileSync('unzip', ['-qq', ZIP, '-d', tmp]);
  const files = fs.readdirSync(tmp).sort();
  console.log('  展開したもの: ' + files.join(' / '));
  check('展開すると index.html がそのまま置かれる', files.indexOf('index.html') >= 0);

  const srv = await serve(tmp);
  const exe = chromiumPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: 700, height: 800 } });

  const pageErrors = [];
  const external = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });
  // 外に取りに行っていないか。1つでもあれば「どこでも動く」が崩れる
  page.on('request', r => {
    if (r.url().indexOf(`http://localhost:${PORT}`) !== 0 && r.url().indexOf('data:') !== 0) {
      external.push(r.url());
    }
  });

  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForTimeout(500);
  check('タイトルが出る', await page.isVisible('button[data-act="play"]'));

  await page.click('button[data-act="play"]');
  await page.waitForTimeout(600);
  check('落下が始まる', await page.evaluate(() => BM.game.state === 'play' && BM.game.player.vy > 100));

  // 自動操縦で実際に潜らせる。開くだけでなく「遊べる」ところまで見る
  await page.evaluate(() => { BM.autopilot.enabled = true; BM.ads.enabled = false; BM.game.newRun(); BM.ui.hide(); });
  await page.waitForTimeout(12000);
  const st = await page.evaluate(() => ({
    depth: BM.game.player.deepest, alive: BM.game.player.alive, score: BM.game.score
  }));
  console.log(`  到達 ${st.depth}m / ${st.alive ? '落下中' : '墜落'} / 点 ${st.score}`);
  check('展開したもので実際に潜れる（60m 以上）', st.depth >= 60, `(${st.depth}m)`);

  await page.screenshot({ path: path.join(__dirname, 'screenshots', 'zip-play.png') });

  check('コンソールにエラーが出ない', pageErrors.length === 0, pageErrors[0] || '');
  console.log('  外部への通信: ' + (external.length ? external.join(', ') : 'なし'));
  check('外部へ一切通信しない（オフラインでも動く）', external.length === 0, external.slice(0, 3).join(' '));

  await browser.close();
  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('');
  if (errors.length) {
    console.log('=== 失敗 ===');
    errors.forEach(e => console.log(e));
    process.exit(1);
  }
  console.log('配布用 ZIP：すべて OK');
})();
