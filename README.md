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
  files: [
    {
      path: "{path in cloud storage}",
      originUrl: "{url}",
      linkUrl: "{url}"
    }, ...
  ],
  updatedAt: "{timestamp}"
}

```

