---
title: "地デジUSBチューナーのブロックノイズが嫌で、ドライバを作り直した（macOS※ / Windows / Android / Linux）"
emoji: "📺"
type: "tech"
topics: ["linux", "macos", "windows", "android", "libusb"]
published: true
---

## TL;DR

録画のブロックノイズと音飛びが嫌で、PLEX PX-S1UD のドライバをカーネルの外に作り直しました。成果物は CLI 一本 `siano-ts` で、MPEG-TS を stdout に出します。Linux・Windows・Android（Termux）は実機で TS が出るところまで確認済みです。※ macOS はビルドが通っているだけで、実機のチューナーはまだ繋いでいません。

[siano-ts](https://github.com/Khronos31/siano-userland) を入れて、mirakc / Mirakurun の tuner command をこれに差し替えてください。

```yaml
# mirakc（channels[].channel は物理番号。例: '27'）
tuners:
  - name: PX-S1UD
    types: [GR]
    command: siano-ts --channel {{{channel}}} --firmware /lib/firmware/isdbt_rio.inp
filters:
  decode-filter:
    command: recisdb decode --input - -
```

```yaml
# Mirakurun
- name: PX-S1UD
  types: [GR]
  command: >-
    siano-ts --channel <channel> --firmware /lib/firmware/isdbt_rio.inp
```

バイナリと `isdbt_rio.inp` は [Releases](https://github.com/Khronos31/siano-userland/releases) に並んでいます。B-CAS は recisdb に任せます。

## 出発点

PX-S1UD は Siano RIO の地デジ USB ドングルで、Linux ならカーネルの `smsusb` / `smsdvb` が `/dev/dvb` を生やしてくれます。うちではそれを mirakc に渡して録画していました。

その録画に、映像のブロックノイズと音声の飛びが乗ります。電波を疑って `C/N` も `UCB` も見ましたが、どちらも問題ありません。USB ハブが犯人だと思い込んで配線を組み替え、それでも直りませんでした。

本丸は `smsdvb-debugfs.c` にありました。debugfs のバッファに `sysfs_emit_at()` を使っています。この関数は sysfs の `show()` 向けで、渡されたバッファがページ境界に乗っていないと `WARN` を出し、何も書かずに帰ります。debugfs 側のバッファは構造体の中にあるので、境界には決して乗りません。

つまり統計を受け取るたびに `WARN` が出ます。しかもそれが走る場所は URB 完了の bottom half で、ここは同じコントローラ配下の USB が共有しています。TS の取りこぼしと `lsusb` のスタックと `/var/log` の数十 GB は、まとめて同じ原因から出ていました。

debugfs を外して `smsdvb` だけ差し替えたところ、同じ 15 分で ffmpeg の `corrupt` は 545 件から 5 件に落ちました。この残った 5 件が何だったのかは、後で測り直したときに分かります。いずれにせよカーネルを上げるたびにモジュールを焼き直すことになりますし、Home Assistant OS のようにカーネルを差し替えられない環境では、その焼き直しすら選べません。

そこまで来て、作り直すことにしました。

## 何を作ったか

`siano-ts` はユーザ空間のドライバで、やっていることは次だけです。

1. libusb で PX-S1UD を開く
2. `isdbt_rio.inp` を載せる
3. 日本の地デジの物理チャンネルに合わせる
4. MPEG-TS を stdout に書く

デーモンでも GUI でもライブラリでもありません。mirakc の tuner `command` が欲しがっている形そのものなので、これ一本で足ります。チューナーを二本使いたければ、同じバイナリをプロセス二つ動かすだけです。

プロトコルは Linux の `smsusb` / `smscoreapi` / `smsdvb`（GPL）をユーザ空間へ移植したもので、本体は GPL-2.0 です。ファームウェア `isdbt_rio.inp` の `LICENCE.siano` は、**無改変のバイナリ形式での再配布を許可**する一方、著作権表示の再現を求め、リバースエンジニアリングを禁じています。実行ファイルへ埋め込むと「無改変のバイナリ」ではなくなるため、Releases ではバイナリの隣にファイルとして置いています。linux-firmware と同じ mere aggregation です。

USB は libusb の API だけを叩き、Linux の usbfs には直接触りません。musl でもビルドが通ります。Android ではアプリから `/dev/bus/usb` を開けないので、外から渡された fd を `libusb_wrap_sys_device` で受け取れるようにしてあります。この三つは最初に決めておかないと、あとから移植するのが高くつきます。rtl-sdr と同じ形です。

## 複数 OS は副産物だった

カーネルを捨てた理由はブロックノイズでした。結果として、カーネルモジュールが無い場所でも同じチューナーが開くようになっています。

| | カーネル `smsusb` | `siano-ts` |
|---|---|---|
| 普通の Linux | 動く。debugfs の WARN と DKMS が残る | 動く |
| Home Assistant OS | `CONFIG_SMS_USB_DRV` が無い | 動く。いまうちの録画はこれ |
| Windows | PLEX のカーネルドライバは HVCI（コア分離）と相性が悪い | WinUSB（Zadig）で、HVCI を切らずに録画できた |
| macOS | 地デジ USB を開く手段が見当たらない | CI でビルドが通る。実機は未 |
| Android | 不可 | Termux の `termux-usb -e` で、Google TV Streamer に挿して TS が出た |

Windows は当初「BonDriver があるから恩恵は小さい」と思っていましたが、これは誤りでした。ユーザ空間なら防御を一段下げずに済みます。

Android は Termux で動くほか、APK 版もあります。

https://github.com/Khronos31/dtv-android

macOS は実機を持っていないため未検証です。動作報告も不具合報告も歓迎します。

## 測って比べた

「カーネルを捨てたが、代わりに品質を落としていないか」を確かめないと意味がありません。同じマシン・同じチャンネル・同じデコーダで、カーネル経路とユーザ空間経路を 5 分ずつ **交互に** 3 本ずつ取りました。交互にしたのは、時間帯による電波と負荷の変動を相殺するためです。

マシンは手持ちで最も非力な Atom のスティック PC です。mirakc は止めて、ドライバから `recisdb` へ直接つないでいます。サービスフィルタもバッファリングも挟まないので、差が出るならドライバの差です。

| | 秒数 | ffmpeg の `Packet corrupt` | 件/分 | CC 誤り | sync 外れ | TEI |
|---|---|---|---|---|---|---|
| kernel-1 | 297 | 1 | 0.20 | 0 | 0 | 0 |
| kernel-2 | 297 | 1 | 0.20 | 0 | 0 | 0 |
| kernel-3 | 298 | 3 | 0.60 | 0 | 0 | 0 |
| userland-1 | 300 | 3 | 0.60 | 0 | 0 | 0 |
| userland-2 | 298 | 3 | 0.60 | 0 | 0 | 0 |
| userland-3 | 298 | 2 | 0.40 | 0 | 0 | 0 |

カーネル経路が 0.34 件/分、ユーザ空間経路が 0.54 件/分。数字だけ見るとユーザ空間のほうが 1.6 倍悪い、と読めます。

ところが **6 本すべてで連続性カウンタの飛びが 0、sync 外れが 0、TEI が 0** でした。1 本あたり約 320 万パケットあって、トランスポート層では 1 つも落ちていません。それなら ffmpeg は何を corrupt と呼んでいるのか。

位置を出しました。**12 件すべてが 297〜298 秒目**、つまりキャプチャの最終フレームに集中しています。先頭には 1 件もありません。正体は `timeout` がプロセスを切った瞬間の書きかけのパケットで、受信品質とは関係ありませんでした。ユーザ空間側が多いのは、`siano-ts` → `recisdb` とパイプ段が 1 つ多いぶん、切断時にバッファへ残る量が大きいからだと思われます。

つまり **5 分の窓では、両者とも欠落ゼロ**です。「カーネル版と同等」ではなく「どちらも定常状態では落としていない」というのが実測でした。冒頭で debugfs を外したあとに残った 5 件も、同じ切断アーティファクトだったと考えるのが自然です。

ひとつ、計測の落とし穴を書いておきます。先頭を捨てて数えようとして `ffmpeg -ss 10` を使うと、**corrupt が増えます**。この 6 本を `grep -c corrupt` で数えると、通常が合計 15 件なのに対し `-ss 10` では 35 件でした。生の TS の途中へシークすること自体が不連続を作るためです。先頭を捨てたいならバイト単位で切ってください。そちらで切って数え直すと、連続性カウンタの飛びは 0 のままでした。

## 使い方

```sh
./siano-ts --list
./siano-ts --channel 27 -t 30 -o /tmp/nhk.ts
```

Windows なら `siano-ts.exe` を同じ引数で叩きます。

mirakc に渡すときは、チャンネル定義の `channel` を物理番号にしてください。

```yaml
tuners:
  - name: PX-S1UD
    types: [GR]
    command: >-
      siano-ts --channel {{{channel}}} --firmware /lib/firmware/isdbt_rio.inp

filters:
  decode-filter:
    command: recisdb decode --input - -
```

B-CAS は recisdb と PC/SC リーダに任せます。decode-filter に置いておけば、番組表スキャンは生 TS の PAT / SDT を読みます。なお USB の URB 長は 188 の倍数ではないため、`siano-ts` の側で TS パケット境界に揃えてから出しています。ここを揃えずに渡すと、mirakc の `scan-services` が空で終わります。

### Windows（Zadig で WinUSB に載せる）

PLEX のドライバが当たったままでは libusb から開けないので、WinUSB に載せ替えます。

1. [Zadig](https://zadig.akeo.ie/) を落として管理者権限で起動する
2. **Options → List All Devices** にチェックを入れる（既にドライバが当たっている機器は、これを入れないと一覧に出ない）
3. 一覧から PX-S1UD を選ぶ。**USB ID が `3275:0080`** であることを確認する
4. 右側のドライバを **WinUSB** にする
5. **Replace Driver** を押す

以後 `siano-ts.exe` から開けます。コア分離（HVCI）も Secure Boot も有効のままで構いません。

戻すときは、デバイスマネージャーで当該デバイスを右クリック → デバイスのアンインストール → 「このデバイスのドライバーを削除します」にチェック → 抜き差しして PLEX のドライバを入れ直します。

:::message
WinUSB に載せ替えたデバイスは、BonDriver からは見えなくなります。同じ機器を BonDriver と `siano-ts` で同時には使えません。
:::

### Android（Termux）

アプリからは `/dev/bus/usb` を開けないので、Termux に fd を取ってもらいます。

```sh
pkg install termux-api libusb
termux-usb -l
termux-usb -r -e "./siano-ts --channel 27 -t 30 -o /sdcard/nhk.ts" /dev/bus/usb/001/002
```

`-r` で権限ダイアログを出し、`-e` に渡したコマンドへ fd を引き渡します。`siano-ts` は末尾に付く整数を fd として解釈するので、`--fd` を明示しなくても通ります。Termux:API アプリの導入も必要です。

### Home Assistant OS

同じ構成のアドオンも置いてあります。

https://github.com/Khronos31/hassio-addons/tree/main/mirakc

## まだ残っていること

上の比較は 5 分の窓の話です。**長時間になると別の顔が出ます。** 別のマシン（Core i5 のノート）で `siano-ts` に 2 局を同時に 3 時間流したときは、ハングも sync 外れも TEI も無かった一方、連続性カウンタの飛びが 423 件と 527 件ありました。こちらはユーザ空間側だけの計測で、カーネル経路の 3 時間は取っていません。10 分の窓で見ると 0〜85 件とばらつき、時間とともに単調に増えるわけではありません。両局とも最初の飛びが同じ時刻に出たので、ホスト側の一時的な停滞だと見ています。末尾 10 分を目視すると僅かなブロックノイズがありました。

つまり「5 分なら完全、3 時間だと数百件」です。ここをゼロにする作業には手を付けていません。普通のテレビとの比較も合否にはしていません。

`smsdvb-debugfs.c` のバグは、まだ上流（linux-media）へ報告していません。Siano のチューナーを使っていれば環境を問わず同じ症状に当たるはずなので、報告は別途行うつもりです。

パッケージは本家へ出します。GitHub Releases の tar / zip（バイナリとファームの併置）はこちらで置きます。`.deb` / `.rpm` / `.msi` は作りません。

mirakc への紹介は [issue 3078](https://github.com/mirakc/mirakc/issues/3078) に書きました。本体への取り込み依頼ではありません。tuner command の一例として知っておいてほしい、という起票です。
