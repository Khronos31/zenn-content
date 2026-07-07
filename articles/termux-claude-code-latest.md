---
title: "Termux(Android)でClaude Codeの最新版をフル機能で動かす"
emoji: "🤖"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: ["termux", "android", "claudecode", "nodejs", "musl"]
published: true
---

:::message
検証日: 2026-07-08。Claude Code / Termux は更新が速いため、記事の内容が古くなっている可能性があります。エラーメッセージが一致しない場合は、まず`npm install -g @anthropic-ai/claude-code`の実行結果を確認してください。
:::

## 結論

Termux(Android)でも、**`proot-distro`でUbuntu等を丸ごと用意せずに、最新版のClaude Codeをフル機能で動かせます**。要点は「muslビルドのバイナリを`patchelf`で書き換え、DNS解決だけ`proot`で補う」という組み合わせです。

そのまま `npm install -g @anthropic-ai/claude-code` を実行すると、以下のエラーで失敗します。

```
Error: claude native binary not installed.
```

原因と、バージョン固定に頼らず解決する手順をまとめます。

## 原因

postinstall を手動実行すると詳細が分かります。

```bash
node $(npm root -g)/@anthropic-ai/claude-code/install.cjs
```

```
[@anthropic-ai/claude-code postinstall] Native binaries for linux-arm64-android are not available on this release channel.
  Available: darwin-arm64, darwin-x64, linux-x64, linux-arm64, linux-x64-musl, linux-arm64-musl, win32-x64, win32-arm64
```

**バージョン2.1.113以降、Android(Termux)向けのネイティブバイナリ配布が打ち切られています。**

CPU(aarch64)は一致していますが、Termuxは Android の `Bionic` libc を使っており、`glibc`/`musl` のどちらとも ABI が異なるため、既製バイナリがそのまま動きません。

## 簡易な回避策(最新版は使えない)

`2.1.112` に固定すれば Android 向けバイナリがまだ存在するため動きます。

```bash
npm uninstall -g @anthropic-ai/claude-code
npm install -g --allow-scripts=@anthropic-ai/claude-code @anthropic-ai/claude-code@2.1.112
```

自動更新で巻き戻されないよう `~/.claude/settings.json` で止めておきます。

```json
{
  "env": { "DISABLE_AUTOUPDATER": "1" }
}
```

CLIの `/model` に新しいモデルが出てきませんが、`--model claude-sonnet-5` のようにフルネームで指定すればAPI自体は問題なく通ります(CLI側の候補一覧に載っていないだけ)。

`proot-distro` でUbuntu等を丸ごと用意する手もあります。glibc環境がそのまま手に入るため公式インストーラがほぼそのまま通りますが、Ubuntu本体のディスク容量が別途必要になり、`apt upgrade`のような継続的なメンテナンス対象も増えます(起動・実行時のオーバーヘッドについては未検証です)。今回はそれを避け、最小限の追加だけで済む方法を採ります。

## 本命: patchelf + musl ランタイム + proot(単発bind mount)

最新版をフル機能・軽量に動かす方法です。要点は3つです。

1. `linux-arm64-musl` 版バイナリを取得し、`patchelf` でインタプリタパスを書き換える
2. `LD_PRELOAD` を解除する(Termuxが全プロセスに強制注入するBionic専用フックが、muslバイナリだとクラッシュするため)
3. `/etc/resolv.conf` が存在しない(Androidは伝統的なDNS解決ファイルを使わない)ため名前解決ができず`FailedToOpenSocket`になる。`proot`で1ファイルだけbind mountして回避する

### 1. ツールを揃える

```bash
pkg install -y patchelf proot
```

### 2. Alpine公式配布物からmuslランタイムを拝借する

Termux自体にはmuslのランタイムが存在しないため、Alpine Linuxの配布物から必要なファイルだけ抜き出します。

```bash
mkdir -p ~/musl-compat/tmp && cd ~/musl-compat/tmp

LATEST_ALPINE=$(curl -fsSL https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/aarch64/ \
  | grep -o 'alpine-minirootfs-[0-9.]*-aarch64.tar.gz' | head -1)
curl -fsSL -o alpine.tar.gz "https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/aarch64/${LATEST_ALPINE}"
tar -xzf alpine.tar.gz ./lib/libc.musl-aarch64.so.1 ./lib/ld-musl-aarch64.so.1

mkdir -p ~/musl-compat/lib
cp lib/ld-musl-aarch64.so.1 ~/musl-compat/lib/
ln -sf ld-musl-aarch64.so.1 ~/musl-compat/lib/libc.musl-aarch64.so.1
```

`libgcc`/`libstdc++`も同様にAlpineのapkパッケージから抜き出します(バージョンは適宜最新に読み替えてください)。

```bash
LIBGCC=$(curl -fsSL https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/ | grep -oE 'libgcc-[0-9][^"]*\.apk' | head -1)
LIBSTDCXX=$(curl -fsSL https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/ | grep -oE 'libstdc\+\+-[0-9][^"]*\.apk' | head -1)

curl -fsSL -o libgcc.apk "https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/${LIBGCC}"
curl -fsSL -o libstdcxx.apk "https://dl-cdn.alpinelinux.org/alpine/v3.24/main/aarch64/${LIBSTDCXX}"

tar -xzf libgcc.apk -O usr/lib/libgcc_s.so.1 > ~/musl-compat/lib/libgcc_s.so.1
SO_PATH=$(tar -tzf libstdcxx.apk | grep -E 'usr/lib/libstdc\+\+\.so\.[0-9.]+$' | head -1)
tar -xzf libstdcxx.apk -O "$SO_PATH" > ~/musl-compat/lib/libstdc++.so.6
```

### 3. DNS解決用のダミーresolv.confを用意

```bash
echo 'nameserver 8.8.8.8' > ~/musl-compat/resolv.conf
echo 'nameserver 1.1.1.1' >> ~/musl-compat/resolv.conf
```

### 4. 最新版のmuslバイナリを取得してpatchelf

```bash
mkdir -p ~/musl-compat/latest-test
npm install --no-save --force --prefix ~/musl-compat/latest-test \
  @anthropic-ai/claude-code-linux-arm64-musl@latest

cp ~/musl-compat/latest-test/node_modules/@anthropic-ai/claude-code-linux-arm64-musl/claude \
  ~/musl-compat/claude-latest-patched

patchelf --set-interpreter ~/musl-compat/lib/ld-musl-aarch64.so.1 \
  --set-rpath ~/musl-compat/lib ~/musl-compat/claude-latest-patched
```

### 5. claude コマンドをラッパーに置き換え

```bash
rm -f $PREFIX/bin/claude
cat > $PREFIX/bin/claude << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
unset LD_PRELOAD
exec proot -b "$HOME/musl-compat/resolv.conf:/etc/resolv.conf" "$HOME/musl-compat/claude-latest-patched" "$@"
EOF
chmod +x $PREFIX/bin/claude
```

### 6. 自動更新を無効化

パッチを当てたバイナリが自動更新で上書きされないよう、公式の設定方法で止めておきます。

```json
// ~/.claude/settings.json
{
  "env": { "DISABLE_AUTOUPDATER": "1" }
}
```

### 動作確認

```bash
claude --version
# => 2.1.202 (Claude Code) のように最新版が表示されればOK
```

## 今後のバージョン更新

手順4〜5を自動化したスクリプトを用意しておくと楽です。

```bash
#!/data/data/com.termux/files/usr/bin/bash
set -e

MUSL_COMPAT="$HOME/musl-compat"
TMPDIR="$MUSL_COMPAT/update-tmp"

rm -rf "$TMPDIR"
mkdir -p "$TMPDIR"

npm install --no-save --force --prefix "$TMPDIR" @anthropic-ai/claude-code-linux-arm64-musl@latest

BIN="$TMPDIR/node_modules/@anthropic-ai/claude-code-linux-arm64-musl/claude"
[ -f "$BIN" ] || { echo "バイナリが見つかりません"; exit 1; }

cp "$BIN" "$MUSL_COMPAT/claude-latest-patched.new"
patchelf --set-interpreter "$MUSL_COMPAT/lib/ld-musl-aarch64.so.1" \
  --set-rpath "$MUSL_COMPAT/lib" "$MUSL_COMPAT/claude-latest-patched.new"

if LD_PRELOAD= proot -b "$MUSL_COMPAT/resolv.conf:/etc/resolv.conf" \
  "$MUSL_COMPAT/claude-latest-patched.new" --version; then
  mv "$MUSL_COMPAT/claude-latest-patched.new" "$MUSL_COMPAT/claude-latest-patched"
  echo "更新成功"
else
  echo "新バイナリの動作確認に失敗。既存バイナリを維持します"
  rm -f "$MUSL_COMPAT/claude-latest-patched.new"
  exit 1
fi

rm -rf "$TMPDIR"
```

動作確認をしてから既存バイナリと入れ替える設計にしているので、万が一新バージョンで何か壊れても安全です。

## ハマりどころメモ

- **`ssh host "cmd"` のような一発コマンド実行は非対話・非ログインシェル**になるため、`.bashrc`に書いた環境変数は読み込まれません。`~/.claude/settings.json` のようなアプリ自身の設定ファイルに書く方が確実です
- **`/lib`・`/etc` はAndroidの読み取り専用領域**で書き込み不可(root権限が必要)。Termuxの書き込み可能領域は `$PREFIX`(`/data/data/com.termux/files/usr`)配下のみです
- npmの `optionalDependencies` によるプラットフォーム判定は `npm install --force <platform-package>@<version>` で上書きできますが、ABIの壁自体は解決しないため、結局patchelf等の追加対応が必要です

## まとめ

| 方法 | 最新版 | 追加のディスク/メンテ対象 | 手間 |
|---|---|---|---|
| バージョン固定(`2.1.112`) | ❌ | 無し | ◎ |
| `proot-distro`でUbuntu | ✅ | Ubuntu本体一式(未検証・数百MB規模と推測) | △ |
| patchelf + musl + proot(単発bind mount) | ✅ | musl関連ライブラリ数MB程度 | △(初回のみ) |

「最新版が使いたい」「でも別のLinux環境をまるごと持ちたくない」という場合は、最後の方法が候補になると思います。実行時の性能差は未検証のため、気になる方は実測してみてください。
