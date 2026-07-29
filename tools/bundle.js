/* =========================================================
   DEEP FALL — 単一 HTML への同梱
     node tools/bundle.js
   index.html / css / js をそのまま 1 ファイルに束ねる。
   ビルドではなく単なる連結なので、ソースと挙動が食い違わない。

   出力は 2 種類：
     dist/deep-fall.html   … 普通に開ける完全な HTML
     dist/artifact.html     … Artifact 公開用（<html>/<head>/<body> 抜き）
   ========================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('index.html');

// <link rel="stylesheet" href="..."> を <style> に置き換える
let out = html.replace(/[ \t]*<link rel="stylesheet" href="([^"]+)">\n?/g, (_, href) =>
  '<style>\n' + read(href).trimEnd() + '\n</style>\n');

// <script src="..."> を中身そのものに置き換える
out = out.replace(/[ \t]*<script src="([^"]+)"><\/script>\n?/g, (_, src) =>
  '<script>\n' + read(src).trimEnd() + '\n</script>\n');

if (/<link rel="stylesheet"|<script src=/.test(out)) {
  console.error('外部参照が残っています。同梱に失敗しました。');
  process.exit(1);
}

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(path.join(DIST, 'deep-fall.html'), out);

// Artifact は <!doctype>/<html>/<head>/<body> を自前で被せるので、中身だけ渡す
// favicon は Artifact 側のパラメータで指定するのでここでは持ち込まない
const title = (out.match(/<title>([\s\S]*?)<\/title>/) || [, 'BLAST RUSH'])[1];
const styles = (out.match(/<style>[\s\S]*?<\/style>/g) || []).join('\n');
const body = out
  .replace(/[\s\S]*?<body>/, '')
  .replace(/<\/body>[\s\S]*/, '')
  .trim();

fs.writeFileSync(
  path.join(DIST, 'artifact.html'),
  ['<title>' + title + '</title>', styles, '', body].filter(Boolean).join('\n') + '\n'
);

const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log('dist/deep-fall.html', kb(fs.statSync(path.join(DIST, 'deep-fall.html')).size));
console.log('dist/artifact.html  ', kb(fs.statSync(path.join(DIST, 'artifact.html')).size));
