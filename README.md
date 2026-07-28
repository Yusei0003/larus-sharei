# larus-sharei

ラルスに関わる帯同審判・帯同MC・その他従事者の謝礼に係る支出を管理するためのものです。

KESEN LARUS BASKETBALL CLUB の「交通費等及び謝礼金支給規程」第5条（帯同審判謝礼金）・第6条（コミッショナー謝礼金）に基づき、対象者への謝礼金を取りまとめるWebアプリです（交通費取りまとめアプリとは別管理）。データはFirebase（Firestore）に保存され、開いた端末同士でリアルタイムに同期されます。ログインは不要です。

## 使い方

0. `index.html` をブラウザで開く（GitHub PagesのURL、または `python3 -m http.server` 等で配信）。ログイン不要で、開いた瞬間にデータが同期されます
1. **入力タブ**: 日付・区分（帯同審判／コミッショナー）を選びます。帯同審判の場合は試合種別（練習試合／公式戦）を選び、練習試合の場合はさらに活動場所（気仙管内／気仙管外）・拘束時間（半日／1日）を選ぶと支給額が自動表示されます（公式戦は2,500円/試合の固定額）。コミッショナーの場合は活動場所のみで支給額が決まります。対象者は、よく依頼する人をプルダウンから選ぶか、「その他（自由入力）」を選んでその都度お名前を入力できます。「登録する」を押すと記録されます
2. **一覧タブ**: 登録済みの記録をスプレッドシート風の表で確認・支給額の修正・削除。月や氏名で絞り込み可能です
3. **対象者の登録・削除**: 入力タブ下部の「よく依頼する対象者の登録・削除」から、頻繁に依頼する人の名前をあらかじめ登録・削除できます。ここに登録していない人への謝礼は「その他（自由入力）」でその都度入力してください（過去の記録に影響はありません）

## データの保存先について

このアプリはFirebase（Firestore）を使ってデータを保存しています。交通費取りまとめアプリ（別リポジトリ）と同じFirebaseプロジェクトを使っていますが、データ領域（コレクション）は別（`sharei_records` / `sharei_meta`）で、こちらはログイン不要で読み書きできるようにFirestoreのセキュリティルールを設定しています。

- 設定値（`firebase-entry.js` 内の `firebaseConfig`）は公開されて問題ない情報です
- このアプリのデータ領域（`sharei_records` / `sharei_meta`）はログインなしで誰でも読み書きできます。URLを知っている人であれば誰でも入力・閲覧・削除ができる点にご注意ください
- **接続にはインターネット接続が必要です**

### firebase-bundle.js について

`firebase-bundle.js` は、Firebase JS SDKと `firebase-entry.js`（初期化コード）を [esbuild](https://esbuild.github.io/) でひとつのファイルにまとめたものです。外部CDNに依存せず動作します。`firebaseConfig` を変更した場合など、再ビルドが必要なときは以下を実行してください。

```
npm install firebase esbuild
npx esbuild firebase-entry.js --bundle --format=iife --platform=browser --minify --outfile=firebase-bundle.js
```

## キャッシュ対策（アセットのバージョニング）

`.github/workflows/version-assets.yml` により、`main` ブランチへのpushのたびにGitHub Actionsが自動的に `index.html` 内の `app.js` / `style.css` / `firebase-bundle.js` の読み込みURLへ `?v=YYYYMMDDHHMMSS`（UTC・push時刻）を付与するコミットを追加します。これにより、コード更新後にブラウザの古いキャッシュが表示され続ける問題を軽減します。GitHub Pagesの設定変更は不要です（Deploy from a branch のまま動作します）。

## 交通費等及び謝礼金支給規程

`交通費等及び謝礼金支給規程.docx` に規程の原本を格納しています。
