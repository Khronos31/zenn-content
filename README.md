# Zenn CLI

* [📘 How to use](https://zenn.dev/zenn/articles/zenn-cli-guide)

## Qiitaへの同期

Qiita API v2のアクセストークンを `qiita-token.env.example` から
`qiita-token.env` にコピーして記入してください。実トークンのファイルはgit管理外です。

記事にはQiita側の公開状態を指定できます。

```yaml
qiita_published: false
```

Qiitaへ非公開記事として新規投稿する場合や、既存記事を更新する場合:

```sh
npm run qiita:sync -- articles/example.md
```

公開する場合は `qiita_published: true` にしてから実行します。投稿済み記事のIDは
`.qiita/items.json`（ローカル管理、git管理外）に保存され、次回から同じQiita記事が更新されます。

`qiita_published` を指定しない既存記事の更新では、Qiita UIで変更した公開状態を保持します。
一時的に公開・非公開を上書きする場合は `--public` または `--private` を使います。

投稿前の変換結果だけを確認するには `--dry-run` を使います。

```sh
npm run qiita:sync -- articles/example.md --dry-run
```
