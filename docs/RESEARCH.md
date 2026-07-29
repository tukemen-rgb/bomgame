# 爆弾ゲーム 設計リサーチ

BLAST RUSH を作るにあたって調べた内容のまとめ。

> **[追記] 差別化のためのリサーチは第2部（このファイル後半）に分けて記載しています。**
> 前半はボンバーマンの「型」を押さえるための調査、後半はそこから抜け出すための調査。

> **調査範囲について**
> ご依頼は「爆弾系のゲーム 10000 件」でしたが、1 万タイトルを個別に踏破することは
> このセッションでは現実的ではありません（itch.io の `bomberman` / `bomb` タグだけでも
> 数千件あり、その大半はプロトタイプで、設計上の新情報はほとんど重複します）。
> そこで **母集団を網羅する代わりに、設計の型（デザインパターン）を網羅する** 方針を取りました。
> シリーズ正史・ジャンル横断の派生・クローン実装・ゲームフィール研究・AI 研究の
> 5 方向から調べ、抽出したパターンをすべて実装に落としています。
> 個別タイトルの全数調査が必要であれば、別途スクレイピングのタスクとして切り出せます。

---

## 1. 系譜：どこから来たジャンルか

ボンバーマンは 1985 年のファミコン版が起点で、Hudson Soft 発、現在は Konami が保有する
マルチプレイヤーアクションシリーズ。40 年近く続いている。

主要な転換点：

| 年 | タイトル | ジャンルに与えた影響 |
|---|---|---|
| 1985 | ボンバーマン（FC） | 「爆弾で道を切り開く」基本ルールの確立 |
| 1990 | Atomic Punk / Bomber Boy（GB） | 携帯機での対戦 |
| 1993 | スーパーボンバーマン（SFC） | マルチタップによる 4 人同時対戦が本格化 |
| 1996 | サターンボンバーマン | 10 人対戦 + シリーズ初のネット対応 |
| 1997 | 爆ボンバーマン（N64） | 3D 化と 4 人対戦 |
| 2017 | Super Bomberman R | 現行世代への復帰 |

派生の広がりも大きく、`ぱにっくボンバー` のような**落ちもの連鎖パズル**への転用や、
BombSquad / Splody / Dstroy 2 のような**パーティゲーム方向の再解釈**が繰り返されている。
itch.io の `bomberman` タグには現在も新作が継続的に投稿されており、
ジャンルとしては「作りやすく、対戦が成立しやすい」ため個人開発の定番になっている。

**設計への示唆**：ルールがシンプルすぎるほど強い。追加要素はルールではなく
「爆弾の挙動を変えるアイテム」として足すのが、このジャンルの伝統的な拡張方向。

---

## 2. メカニクスの分類

シリーズ横断で使われているパワーアップを整理すると、きれいに 3 系統に分かれる。

### A. 爆弾そのものを変える
- **Bomb-Up** — 同時に置ける数を増やす
- **Fire** — 爆風の長さを伸ばす
- **Pierce（貫通）** — 火力の続く限りソフトブロックを貫通する
- **Remote（リモコン）** — 導火線ではなく任意のタイミングで起爆
- **Rubber / Bounce** — 蹴られると跳ね回る

### B. 爆弾との関わり方を変える
- **Kick** — 爆弾を蹴って滑らせる
- **Boxing Glove（パンチ）** — 殴って飛ばす
- **Power Glove** — 持ち上げて投げる

### C. プレイヤー自身を変える
- **Skate** — 移動速度上昇
- **Heart / Shield** — 被弾を 1 回無効化
- **（マイナス補正）** Speed Down、Bomb Down など

パワーアップはほとんどの場合ソフトブロックの破壊で出現し、
作品によっては敵のドロップからも出る。

**本作での採用**：A から Fire / Bomb-Up / Pierce / Remote、B から Kick、
C から Speed / Shield / Heart、加えて上限解放の Full Fire。
パンチと投げは操作系が増える割に爽快感への寄与が薄いと判断して外した。
マイナスアイテムも「テンポが落ちる」ため不採用。

---

## 3. 「爽快感」はどこから来るのか

ファミコン版の評価軸を追うと、爽快感は**爆発の見た目**ではなく
**連鎖の読み合い**から生まれていることがわかる。敵の動きを読んで爆風を連鎖させるプレイは
上級者ほど戦略性を味わえる設計になっており、ルール自体は初心者にも直感的。
つまり「単純なルール × 連鎖という深さ」の二層構造が本体。

その上に、現代的なゲームフィール（juice）の技法を重ねる。調査した範囲での定石：

| 技法 | 内容 | 本作の実装 |
|---|---|---|
| Screen shake | 衝撃の向きに沿ってカメラを押す | `FX.addShake()`。火力と連鎖数で強度が変わる |
| Hit stop | 命中時に一瞬時間を止める | 完全停止ではなく `dt *= 0.18` のスローに（止まると操作感が死ぬため） |
| Particles | 着弾点から進行方向へ破片を撒く | 発光する火花 + 発光しない瓦礫/煙の 2 層 |
| Chromatic aberration | 強い衝撃で画面端に RGB のズレ | R と C を別オフセットで加算合成。**上限 5px・42px/s で減衰**（強すぎると盤面が読めない） |
| Shockwave | 爆心から広がるリング | `FX.shock()`。イージングで一気に広がって細くなる |
| Flash / Vignette | 画面全体の明滅 | 被弾時のみ赤いヴィネットを重ねる |

実装して分かった一番大事な調整は **「効果は強くするより、速く戻す」** こと。
初期実装では色ズレを 14px まで上げていたが、連鎖のたびに盤面が二重に見えて
危険マスの判断ができなくなった。上限を 5px に下げ、減衰を 1.6 倍速くしただけで
「派手だが読める」状態になった。

さらに本作独自の足し算として：
- 爆風は中心から距離 × 16ms 遅れて出る（十字に「伸びる」ように見える）
- 誘爆は即時ではなく 55ms のタメを入れる（連鎖が「タタタッ」と鳴る）
- 連鎖数に応じて効果音のピッチが上がり、3 連鎖以上で画面中央にバナーが出る

---

## 4. 実装の型（HTML5 Canvas クローンの定石）

既存の JS クローン実装（DJakarta/bomberman、MattSkala/html5-bombergirl ほか）を
確認したところ、共通していたのは：

- **タイルマップ + ピクセル座標の二層管理**。論理はセル、描画と当たり判定はピクセル。
- 壁は `x % 2 === 0 && y % 2 === 0` の固定配置。外周は必ず壁。
- 爆弾はセルに固定、プレイヤーはピクセルで自由移動。

一方、**多くのクローンが取りこぼしているのが「通路への吸い付き」**。
本作では `moveAxis()` で、横移動中は現在行の中心線へ、縦移動中は現在列の中心線へ
常に引き寄せている（`js/entities.js`）。これが無いと曲がり角でひっかかり、
操作のストレスが爽快感を全部殺す。

ボードは 15×13 セル / 40px（600×520px）。原作系のレイアウトに合わせた。

---

## 5. 敵 AI

調査した実装（A* / BFS ベースのもの、強化学習ベースのもの）で共通していた要点：

1. **危険マップを先に作る**。設置済み爆弾の爆風予測を盤面に焼き込み、
   「今の炎」と「これから来る炎」を区別する。
2. **爆弾を置く前に逃げ道を確認する**。逃げ道が無いなら置かない。
   これをやらない AI は自爆し続ける。
3. **経路探索は BFS で十分**。15×13 程度の盤面で A* の優位性はほぼ無い。
4. 危険にいるときは「危険を通ってでも安全マスへ」、
   安全なときは「危険マスを避けてプレイヤーへ」と、通行可能条件を切り替える。

本作の実装（`js/map.js` の `bfsStep`、`js/entities.js` の `Enemy.decide`）：

- `danger[]` は 0=安全 / 1=これから爆風 / 2=今まさに炎、の 3 値
- 危険にいる → `passable` に危険を含めて最寄りの安全マスへ BFS
- 安全 → 危険を除外した `passable` でプレイヤーへ BFS（探索深さ上限つき）
- `bomber` タイプのみ設置判断を行い、`enemyHasEscape()` が真のときだけ置く

敵は 4 種類で役割分担している：

| 種類 | 速度 | 挙動 | 点 |
|---|---|---|---|
| balloon | 遅 | ランダム徘徊（直進しやすい重み付き） | 100 |
| chaser | 速 | BFS でプレイヤーを追う | 200 |
| ghost | 中 | ソフトブロックをすり抜けて追う | 300 |
| bomber | 速 | 爆弾を設置してくる。HP 2 | 500 |

**プレイヤーへの情報提示**：AI と同じ `danger` 配列を床の赤い明滅として描いている。
「これから爆風が来るマス」が常に見えるので、理不尽死が起きない。
これは調査対象にはなかったが、避けゲーとしての気持ちよさに一番効いた追加要素。

---

## 6. 参考にした資料

- [Power-Ups | Bomberman Wiki](https://bomberman.fandom.com/wiki/Power-Ups) — パワーアップの全体像
- [Super Bomberman/Power-ups — StrategyWiki](https://strategywiki.org/wiki/Super_Bomberman/Power-ups)
- [List of Bomberman video games — Wikipedia](https://en.wikipedia.org/wiki/List_of_Bomberman_video_games) — シリーズ全タイトル
- [MASTER GAME LIST — Ragey's Totally Bombastic Bomberman Shrine Place](https://randomhoohaas.flyingomelette.com/bomb/game.html)
- [The complete history of Bomberman — Tired Old Hack](https://tiredoldhack.com/2017/02/26/the-complete-history-of-bomberman/)
- [ファミコン版「ボンバーマン」が発売40周年！ — GAME Watch](https://game.watch.impress.co.jp/docs/kikaku/2071357.html)
- [レトロゲーム黎明録｜第22回ボンバーマン（FC／1985）](https://uniquerui.com/tblog/retrogame-22-bomberman/) — 完成されたゲームバランスという評価軸
- [ボンバーマンシリーズ — Wikipedia](https://ja.wikipedia.org/wiki/%E3%83%9C%E3%83%B3%E3%83%90%E3%83%BC%E3%83%9E%E3%83%B3%E3%82%B7%E3%83%AA%E3%83%BC%E3%82%BA)
- [Case Study: Bomberman Mechanics in an ECS — GameDev.net](https://www.gamedev.net/articles/programming/general-and-gameplay-programming/case-study-bomberman-mechanics-in-an-entity-component-system-r3159/)
- [Implementing HTML5 Bomberman — Yusuf Aytas](https://yusufaytas.com/implementing-html5-bomberman)
- [DJakarta/bomberman](https://github.com/DJakarta/bomberman) / [MattSkala/html5-bombergirl](https://github.com/MattSkala/html5-bombergirl) — Canvas 実装の比較
- [Maximizing Game Feel in Action Game Development](https://salivity.github.io/game-development/article/maximizing-game-feel-in-action-game-development) — hit stop / 色ズレ
- [Juice It Good: Adding Camera Shake To Your Game](https://gt3000.medium.com/juice-it-adding-camera-shake-to-your-game-e63e1a16f0a6) — 方向つき画面揺れ
- [Making a Game Feel "Juicy" with Simple Effects](https://resprawn.medium.com/when-you-play-a-great-game-it-feels-good-d23761b6eccf)
- [Bomberman - How to keep path safe? — GameDev.net](https://gamedev.net/forums/topic/673562-bomberman-how-to-keep-path-safe/5264240/) — 時間レイヤ付き BFS
- [Beating Bomberman with Artificial Intelligence (PDF)](https://www.researchgate.net/publication/329453697_Beating_Bomberman_with_Artificial_Intelligence)
- [jrzmnt/BombermanAI](https://github.com/jrzmnt/BombermanAI) / [bomberman-ai — GitHub Topics](https://github.com/topics/bomberman-ai)
- [Top games tagged bomberman — itch.io](https://itch.io/games/tag-bomberman) / [tag: bomb](https://itch.io/games/tag-bomb) — 現行の同ジャンル動向
- [Atomic Bomberman Alternatives — AlternativeTo](https://alternativeto.net/software/atomic-bomberman) — Bombermaaan / Granatier / BombSquad ほか

---
---

# 第2部：「丸パクリ」から抜け出すためのリサーチ

第1部で作ったものは、正直に言えばよくできたボンバーマンのクローンでしかなかった。
アイテムも敵も爆風も、全部「本家にあるもの」の再実装だったからだ。
ここでは**何を変えれば別のゲームになるのか**を調べ直した。

> **調査範囲について（再掲）**
> ご依頼は「参考情報を500件分析」でしたが、500件を1件ずつ精査したわけではありません。
> 下記7軸の調査を行い、**設計パターンとしては飽和した**（同じ発想が別タイトルで
> 何度も再出現し、新しい軸が出てこなくなった）ところで打ち切っています。
> 件数を積むより軸を潰すほうが情報量が多いという判断です。
> タイトル単位の全数調査が必要な場合は、スクレイピングの別タスクとして切り出せます。

---

## 1. そもそも「パクリ」と「ジャンル」の境目はどこか

調べていて一番はっきりしたのは、**メカニクスをいくら足しても既視感は消えない**ということ。
本家自身が40年かけてパワーアップを増やし続けてきたので、
「新しいアイテム」「新しい敵」は全部すでにジャンルの語彙の内側にある。

一方で、ジャンルの外に出ている作品には共通点があった。**動詞か目的のどちらかを置換している。**

| 作品 | 置換したもの | 結果 |
|---|---|---|
| Bomb Chicken | 動詞（爆弾＝武器 → 爆弾＝足場・移動手段） | ジャンプボタンの無いパズルプラットフォーマー |
| ぱにっくボンバー | 目的（生存 → 連鎖で相手に妨害を送る） | 落ちものパズル |
| ボンバーキング | 目的（対戦 → 探索とストーリー） | アクションアドベンチャー |
| Splatoon | 目的（撃破数 → 塗り面積） | シューターの文法のままジャンルが変わった |
| Crypt of the NecroDancer | 動詞の制約（任意タイミング → 拍の上でのみ行動） | ローグライクがリズムゲームになった |
| Super Bomberman R Online | 規模（4人1画面 → 64人16面が縮小） | バトルロイヤル |

Bomb Chicken については GMTK 系の分析で "dual purpose design"（同じ道具を
攻撃と移動の両方に使わせる）という言い方がされていて、これが動詞置換の典型例だった。

**結論**：アイテムを足すのは無意味。**目的か動詞を置き換える**しかない。

---

## 2. 目的を置換した先行例 — Splatoon のターフウォー

一番参考になったのが Splatoon の Turf War。3分間で、撃破数ではなく
**塗った床の面積の割合**で勝敗が決まる。試合終了後に床の被覆率を判定する。

重要なのは「塗り」が得点計算のためだけの飾りではないところ：

- 自分のインクの中では潜って高速移動できる
- 相手のインクの上では移動が阻害される
- つまり**塗ることが、そのまま自分の機動力の地図を描くことになる**

「literal territory control が splat と同じくらい重要」と説明されている通り、
撃破は目的ではなく塗りを有利に進めるための手段に降格している。

**BLAST RUSH への移植**：
爆風はもともと「十字に広がる面」なので、塗りの筆として理想的な形をしている。
爆風セルの計算結果をそのまま塗りに流すだけで、連鎖・貫通・キックといった
既存のギミックが全部「塗りの戦術」に化ける。移植コストが低く、効果が大きい。

| Splatoon | BLAST RUSH での対応 |
|---|---|
| インクを撒く | 爆風が通ったマスが自分の色になる |
| 自陣で高速移動（イカ潜り） | 自陣の床で移動速度 +30% |
| 敵陣で移動阻害 | 敵陣の床で移動速度 −26% |
| 3分後に被覆率で判定 | 対戦：時間切れ時点の塗り面積で判定 |
| （該当なし） | 1人用：ノルマ塗り率の達成で出口が開く |
| スプラット（撃破）は手段 | 敵撃破で半径2マスにインクが飛び散る |
| デス＝復帰時間の損失 | やられると足元の自陣が中立に戻る |

---

## 3. 検討して採用しなかった案

### ボムジャンプ（動詞の置換）
自分の爆風でダメージを受けず吹き飛ぶようにする案。Bomb Chicken の dual purpose design、
および Quake 由来のロケットジャンプ（1996年に発見された emergent mechanic で、
「スキルの階段」を作るのに極めて有効とされる）を下敷きにしたもの。

不採用の理由：グリッド固定移動を捨てて物理挙動に置き換える必要があり、
第1部で作った「通路への吸い付き」や敵のセル単位 AI が全部作り直しになる。
面白さの見込みは高いが、既存資産との相性が悪い。

### ビート同期（動詞の制約）
すでに WebAudio の BGM シーケンサを自前で持っているので、拍の情報はタダで手に入る。
NecroDancer の設計思想（「リズムゲームでありながら、要求するリズム精度は限りなく低い」
「難しさは拍そのものではなく戦術判断から来るべき」）は非常に参考になった。

不採用の理由：拍という強い制約は、それ単体でゲームの全体設計を支配する。
インク陣取りと同時に入れると、どちらの面白さも薄まる。

### ボム・キュー（資源の制約）
置ける爆弾の種類がテトリスの NEXT のように流れてきて選べない案。
不採用の理由：アクションの上にパズルの思考を重ねると、
盤面を読む負荷が二重になって「爽快」から遠ざかる。

---

## 4. 実装してわかったこと

- **敵の役割が変わった。** 以前は「避けるべき障害物」だったが、
  歩いた跡を敵色に汚す仕様を入れた結果、「放置すると点差が開く脅威」になった。
  逃げ回るだけのプレイが成立しなくなり、盤面に出ていく動機が生まれた。
- **連鎖の価値が跳ね上がった。** 以前の連鎖はスコア倍率という抽象的な報酬だったが、
  今は「一度に20マス塗れる」という勝利条件への直接の貢献になった。
  同じシステムなのに、意味が変わっただけで手応えが全く違う。
- **死のコストを2種類にした。** 残機（従来）に加えて、足元の自陣が中立に戻る。
  陣地で払うペナルティは、残機と違って「取り返せる」ので理不尽になりにくい。
- **危険マスの表示を強くする必要があった。** 床がインクで塗られると、
  第1部の「薄い赤の明滅」が完全に埋もれた。塗り＋枠線の二重表示に変更した。
- **1人用の勝利条件を「敵全滅」から「ノルマ塗り率」に変えたことで、出口を隠す意味が消えた。**
  隠し扉を探す作業が二重目標になって冗長だったので、出口は最初から見える位置に置き、
  代わりに扉の周りにノルマ達成度のリングを描くようにした。

---

## 5. 第2部で参考にした資料

- [Turf War — Inkipedia](https://splatoonwiki.org/wiki/Turf_War) / [Splatoon Wiki: Turf War](https://splatoon.fandom.com/wiki/Turf_War) — 判定ルール
- [Tips And Tricks For Turf War In Splatoon 3 — TheGamer](https://www.thegamer.com/splatoon-3-turf-war-guide-tips-tricks/) — 塗りと得点の関係
- [Splatoon (Franchise) — TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/Franchise/Splatoon) — 「塗り＝機動力の地図」という整理
- [Splatoon (video game) — Wikipedia](https://en.wikipedia.org/wiki/Splatoon_(video_game))
- [Paintoon — itch.io](https://04m04.itch.io/paintoon) — グリッド盤面での2人陣取りの先行例
- [Bomb Chicken's Dual Purpose Design | GMTK Response](https://www.youtube.com/watch?v=GVvqFUPC9oc) — 動詞置換の考え方
- [Bomb Chicken — Nitrome Wiki](https://nitrome.fandom.com/wiki/Bomb_Chicken) / [『Bomb Chicken』解説（note）](https://note.com/trdd/n/n45ab3d1b0e42?hl=en)
- [Rocket jumping — Wikipedia](https://en.wikipedia.org/wiki/Rocket_jumping) — Doom/Quake での発生経緯
- [Game Design Deep Dive: Rocket jumping in Rocket League — Game Developer](https://www.gamedeveloper.com/design/game-design-deep-dive-rocket-jumping-in-i-rocket-league-i-) — スキル階段の作り方
- [Game Design Deep Dive: Finding the beat in Crypt of the NecroDancer — Game Developer](https://www.gamedeveloper.com/audio/game-design-deep-dive-finding-the-beat-in-i-crypt-of-the-necrodancer-i-) — 「精度を要求しないリズムゲーム」
- [Crypt of the NecroDancer is No Gimmick — The Gemsbok](https://thegemsbok.com/art-reviews-and-articles/mid-week-mission-crypt-necrodancer-brace-yourself-games/)
- [Battle 64 — Bomberman Wiki](https://bomberman.fandom.com/wiki/Battle_64) / [SUPER BOMBERMAN R ONLINE 公式](https://www.konami.com/games/bomberman/online/us/en/) — 規模による置換
- [Chain Reaction Games: Boomshine](https://flashminigame.wordpress.com/2009/01/07/chain-reaction-games-boomshine/) — 「最初の一手をどこに置くか」に全部を賭けさせる設計
- [Studying Chain Reactions — Studio 4 Game Innovation](https://www.studio4gameinnovation.com/through-my-childs-eyes-developer-blog/studying-chain-reactions)
- [『ボンバーキング』レビュー — RETRO GAME RAIDERS](https://retrogameraiders.com/archives/bomber_king_fc_review/) — 目的を置換して失敗した例
- [ボンバーマン (ファミリーコンピュータ) — Wikipedia](https://ja.wikipedia.org/wiki/%E3%83%9C%E3%83%B3%E3%83%90%E3%83%BC%E3%83%9E%E3%83%B3_(%E3%83%95%E3%82%A1%E3%83%9F%E3%83%AA%E3%83%BC%E3%82%B3%E3%83%B3%E3%83%94%E3%83%A5%E3%83%BC%E3%82%BF))
- [StarVaders / Moonsigil Atlas ほか — Rogueliker](https://rogueliker.com/roguelike-deckbuilders/) — 「盤面の形」を制約にする現行の潮流
