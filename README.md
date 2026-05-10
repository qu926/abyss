# ホスイベ勤怠・予約管理SPA

ホスイベ向けの勤怠、未入力者、長期休暇、イベント日、予約枠、シャンパン・タワー上限を管理する静的SPAです。

## 起動方法

ES Modulesを使っているため、ローカルHTTPサーバー経由で開いてください。

```powershell
cd D:\Ai\abyss\host-event-manager
node server.cjs
```

ブラウザで `http://localhost:4173/` を開きます。

依存パッケージはないため、`npm install` は不要です。`npm` を使う場合、PowerShellの実行ポリシーで止まる環境では `npm.cmd run start` を使ってください。

## パスワード

- サイト全体パスワード: `abyss`
- 運営パスワード: `abyss2026`

このパスワードは静的サイト内の簡易ロックです。本番向けの認証やアクセス制御ではありません。

## データ保存

- 初期状態ではブラウザの `localStorage` に保存されます。
- 共有運用する場合は Supabase を設定すると、別PC・別スマホでも同じ予約状況を見られます。
- 運営画面の「データ」からJSONを書き出せます。

## Supabase共有DB設定

1. Supabaseでプロジェクトを作成します。
2. SQL Editorで `supabase/schema.sql` を実行します。
3. Project Settings > API から Project URL と anon public key を確認します。
4. `js/config.js` を以下のように変更します。

```js
window.ABYSS_CONFIG = {
  storageMode: "supabase",
  supabaseUrl: "https://xxxxx.supabase.co",
  supabaseAnonKey: "xxxxx",
  stateRowId: "host-event-manager",
};
```

この構成は小規模運用向けの簡易共有です。GitHub Pages上の静的サイトなので、サイトPWは本格的な認証ではありません。

## 主要機能

- ホスト側の勤怠入力、更新
- ホスト側の予約グリッド入力、編集、削除
- 運営画面の共通パスワード保護
- 運営トップの勤怠、予約枠、上限、要確認リスト
- ホスト一覧、ロール、有効無効、メモ管理
- 長期休暇管理と未入力者からの除外
- イベント日管理、休み日設定、水曜22時予約解放
- 通常席8枠、アイバン席2枠の固定グリッド
- シャンパン、タワー上限チェック
- 勤怠との照合警告
- Discord催促文、予約確認文のコピー
- 変更履歴の保存

## MVPの注意点

- サーバー、データベース、個別ログインアカウントはありません。
- 複数人で同時編集した場合の競合管理はありません。
- ブラウザのサイトデータ削除やシークレットモード終了でデータが消える場合があります。
- 本番運用前にJSONバックアップ手順を決めてください。
