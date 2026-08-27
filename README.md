# はじめに

Google Driveのファイルを、Cloud Storage(GCS, S3)へ同期するプログラム


# 詳細

Google Driveのファイルを、ファイル化してCloud Storageへコピーし同期するプログラム

|ファイル種類|変換方法|
|:--|:--|
|Googleドキュメント|Markdownに変換してアップロード。埋め込まれた画像は削除|
|Googleスプレッドシート|CSVに変換してアップロード。シート毎にCSVファイルを保存|
|Googleスライド|除外|
|pdf|pdfのままコピー|
|テキストファイル(txt,xml,json, etc)|そのままコピー|
|画像(png, jpeg, svg)|そのままコピー|
|画像(webp, heic)|jpegに変換してコピー|
|その他|除外|

# メタデータ

コピー元のリンクを示すjsonを保存する

```json
{
  "files": [
    {
      "path": "{path in cloud storage}",
      "originUrl": "{url}",
      "linkUrl": "{url}"
    }, ...
  ],
  "updatedAt": "{timestamp}"
}

```

- `originUrl`: ファイルIDから組み立てた `https://drive.google.com/open?id={fileId}` 形式のURL
- `linkUrl`: Driveの共有URL(Drive APIの`webViewLink`の`usp`を`sharing`に置き換えたもの)。例: `https://docs.google.com/document/d/1SDDg4I_b8s8b0_PFtmtn-LxHNH8Y70M7kIHNUVUGkbo/edit?usp=sharing`。取得できなかった場合は`originUrl`と同じ値になる

# 使い方

## インストール

npmパッケージ(`@takezoux2/google-drive-to-cloud-storage`)として実行できる(`bin: gdrive-to-cloud-storage`)。GitHub Actionsで[GitHub Packages](https://github.com/takezoux2/google-drive-to-cloud-storage/pkgs/npm/google-drive-to-cloud-storage)へ自動publishされる(GitHub Releaseを公開すると`.github/workflows/publish.yml`が実行される)。

GitHub Packagesはpublicパッケージでもnpm CLIでの取得に認証が必要。`~/.npmrc`(またはプロジェクトの`.npmrc`)に以下を設定し、`read:packages`権限を持つGitHub Personal Access Tokenを用意する:

```
@takezoux2:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

グローバルインストールする場合:

```bash
npm install -g @takezoux2/google-drive-to-cloud-storage
```

インストールせず`npx`で直接実行する場合:

```bash
npx @takezoux2/google-drive-to-cloud-storage --config config.yaml
```

リポジトリから直接ビルドして使う場合:

```bash
pnpm install
pnpm build
```

## 設定ファイル

`config.yaml`を作成する:

```yaml
mappings:
  - driveFolderId: "1AbCdEfGhIjKlMnOpQrStUvWxYz"
    destination:
      provider: gcs
      bucket: "my-bucket"
      prefix: "backups/team-a"
    exclude:
      fileIds:
        - "1ExcludedFolderOrFileId"
      namePatterns:
        - "^_.*"
        - "\\.tmp$"

  - driveFolderId: "1AbCdEfGhIjKlMnOpQrStUvWxYz2"
    destination:
      provider: gcs
      bucket: "my-bucket"
      prefix: "backups/team-a2"
    include:
      fileIds:
        - "1IncludedFolderOrFileId"
      namePatterns:
        - "\\.pdf$"

  - driveFolderId: "2XyZ..."
    destination:
      provider: s3
      bucket: "my-s3-bucket"
      region: "ap-northeast-1"
      prefix: "backups/team-b"

  - driveFolderId: "3PqRsTuVwXyZ..."
    destination:
      provider: local
      path: "./backups/team-c"
      prefix: "docs"
```

`provider: local`の場合は`bucket`の代わりに`path`(保存先ディレクトリ)を指定する。ディレクトリが存在しない場合は自動作成される。

`exclude`は省略可能。`fileIds`はDrive上のファイル/フォルダIDの完全一致リスト、`namePatterns`はファイル/フォルダ名(パスではなく名前のみ)にマッチする正規表現のリスト。フォルダがマッチした場合はその配下ごと同期対象から除外され、ファイルがマッチした場合はそのファイル単体が除外される(他のMIME種別による除外と同じ扱い)。

`exclude`に追加した時点で既にコピー先に同期済みのファイルがある場合、次回の同期実行時にそのコピーはコピー先から削除される(MIME種別による除外と同じ挙動)。適用前に`--dry-run`で削除対象を確認することを推奨する。

`include`も省略可能。書式は`exclude`と同じ(`fileIds`/`namePatterns`)だが、意味は逆で、`include`を設定した場合はマッチしたファイルのみが同期対象になり、マッチしなかったファイルは`exclude`と同じ扱い(除外)になる。`include`はファイル単体の判定にのみ使われ、フォルダの走査(再帰)には影響しない — フォルダ自体は`exclude`にマッチしない限り常に配下まで走査される。`include`と`exclude`を両方設定した場合は、まず`include`で対象を絞り込み、次に`exclude`で除外を判定する(`include`にマッチしても`exclude`にもマッチすれば除外される)。`include`を追加した時点で既にコピー先に同期済みのファイルがある場合の挙動も`exclude`と同様で、`include`にマッチしなくなったファイルは次回の同期実行時にコピー先から削除される。

```yaml
rename:
  - from: "photo" # 拡張子なし → ベース名で一致判定(photo.jpg, photo.png 等にマッチ)
    to: "cover" # 拡張子なし → マッチしたファイルの元の拡張子を維持(例: cover.jpg)
  - from: "old_report.pdf" # 拡張子あり → ファイル名と完全一致
    to: "report_2024.pdf" # 拡張子あり → そのまま出力名として使用

mappings:
  - driveFolderId: "1AbCdEfGhIjKlMnOpQrStUvWxYz"
    destination:
      provider: gcs
      bucket: "my-bucket"
```

`rename`は省略可能。`exclude`/`include`とは異なり**mapping単位ではなくconfig全体に1つだけ**設定し、全mappingに共通で適用される。`from`に拡張子が含まれていない場合、対象ファイル名の拡張子を無視してベース名のみで一致判定する。`to`に拡張子が含まれていない場合、マッチしたファイルの元の拡張子を出力名に付与する。複数のルールに一致しうる場合は配列の先頭から順に評価し、最初にマッチしたルールのみが適用される。リネームはファイルのみが対象でフォルダ名には適用されない。また、`exclude`/`include`の判定は常にリネーム前の元のDriveファイル名に対して行われる。

メタデータ上の`sourcePath`はリネーム後のパスで記録されるため、`rename`ルールを追加・変更すると、対象ファイルは次回の同期実行時に別ファイル(新規ファイル)として扱われる。その結果、コピー先の旧名でのコピーは削除され、新しい名前で再アップロードされる。これはファイル総数が0件になるケースを検知するマスデリート防止ガード(前述)では検出できない挙動のため、`rename`ルールを適用する前に`--dry-run`で削除・アップロード対象を確認することを推奨する。

複数の`rename`ルール(または拡張子なしの`from`が`photo.jpg`と`photo.png`のように拡張子違いの複数ファイルにマッチするケース)が同一mapping内で同じ出力パスを生成した場合、コピー先には最終的にそのうち1件しか残らない。このような出力パスの衝突は実行時に検出・警告されないため、`rename`ルールは同一mapping内で出力パスが重複しないように設計すること。

拡張子の判定はNode.jsの`path.extname()`の仕様にそのまま従うため、最後の`.`より後ろの部分のみが「拡張子」とみなされる。そのため`2026.08.14 議事録`のようにドットを複数含むファイル名(例: Googleドキュメントのタイトル)では、`.14 議事録`が`path.extname()`上の「拡張子」として扱われ、拡張子なしの`to`と組み合わせた場合に意図しない出力名になることがある。ファイル名に(本来の拡張子以外の)ドットが含まれる場合は、`--dry-run`で`rename`の出力結果を必ず確認すること。

実行が全mapping分終わった後、`rename`に定義したルールのうち今回の実行で一度もファイルにマッチしなかったものは、`Rename rule not matched: from="..." to="..."`という形でログに出力される(`--dry-run`でも出力される)。いずれかのmappingでマッチすればそのルールは「マッチした」扱いになり、mapping単位では報告されない。

このマッチ判定はDrive走査中に`exclude`/`include`によるフィルタ適用前に行われるため、`exclude`/`include`で個別に除外されるファイルであっても、名前がマッチすれば該当ルールは「マッチした」扱いになる。ただし、マッチするファイルが`exclude`にマッチしたフォルダの配下にしか存在しない場合、そのフォルダ自体が走査されないため該当ルールは「マッチしなかった」と報告される。また、前述のとおりルールは配列の先頭から順に評価され最初にマッチしたルールのみが適用されるため、常に前段のルールに同じファイルを奪われて自分自身がマッチする機会がないルールも「マッチしなかった」と報告される(そのルールが以降のルールに埋もれて到達不能であることを示すシグナルとして扱ってよい)。

## 認証

- Google Drive: ADC(Application Default Credentials)で取得したサービスアカウントを使用する。事前に`gcloud auth application-default login`、または`GOOGLE_APPLICATION_CREDENTIALS`環境変数でサービスアカウントキーを指定する
- GCS: Google Cloudのデフォルト認証(ADC)を使用する
- S3: AWSのデフォルト認証チェーン(環境変数、`~/.aws/credentials`、IAMロール等)を使用する

## 実行

グローバルインストール、または`npx`で実行する場合:

```bash
gdrive-to-cloud-storage --config config.yaml
gdrive-to-cloud-storage --config config.yaml --dry-run
```

リポジトリから直接ビルドして実行する場合:

```bash
node dist/cli.js --config config.yaml
node dist/cli.js --config config.yaml --dry-run
```
