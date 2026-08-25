---
title: "地デジUSBチューナーのブロックノイズが嫌で、ドライバを作り直した（macOS / Windows / Android / Linux）"
emoji: "📺"
type: "tech"
topics: ["linux", "macos", "windows", "android", "libusb"]
published: true
---

## TL;DR

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

バイナリと `isdbt_rio.inp` は [Releases](https://github.com/Khronos31/siano-userland/releases) に並んでいます。B-CAS は recisdb です。詳細は以下です。

録画のブロックノイズと音飛びが嫌で、PLEX PX-S1UD のドライバをカーネルの外に作り直しました。成果物は CLI 一本 `siano-ts` で、MPEG-TS を stdout に出します。Linux・Windows・Android（Termux）は実機で TS が出るところまで見ました。macOS はビルドが通ります。実機のチューナーはまだ繋いでいません。

## 出発点

PX-S1UD は Siano RIO の地デジ USB ドングルで、Linux ならカーネルの `smsusb` / `smsdvb` で `/dev/dvb` になります。うちではそれを mirakc に渡して録画していました。

映像はブロックノイズ、音声は飛びます。電波は悪くありません。`C/N` も `UCB` も問題に見えません。USB ハブが犯人だと思い込んで配線を組み替えましたが、直りませんでした。

あとから分かった本丸は、`smsdvb-debugfs.c` が debugfs のバッファに `sysfs_emit_at()` を使っていることでした。これは sysfs の `show()` 向けで、ページ境界に乗っていないと `WARN` して何も書きません。debugfs 側のバッファは構造体の中なので、必ず外れます。その WARN が URB 完了の bottom half の中で走り、同じコントローラ配下の USB がまとめて詰まります。TS の取りこぼし、`lsusb` のスタック、`/var/log` が数十 GB、が同時に出ます。

debugfs を外して `smsdvb` だけ差し替えると、同じ 15 分で ffmpeg の `corrupt` は 545 件から 5 件になりました。ゼロにはなりません。カーネルを上げるたびにモジュールを焼き直します。Home Assistant OS のようにカーネルを差し替えられない環境では、その差し替えすらできません。

そこまで来て、作り直すことにしました。

## 何を作ったか

`siano-ts` はユーザ空間のドライバで、やっていることは次だけです。

1. libusb で PX-S1UD を開きます
2. `isdbt_rio.inp` を載せます
3. 日本の地デジの物理チャンネルに合わせます
4. MPEG-TS を stdout に書きます

デーモンでも GUI でもライブラリでもありません。mirakc の tuner `command` が欲しい形そのものなので、一本で足ります。同じバイナリをプロセス二つにすればチューナー二本になります。

プロトコルは Linux の `smsusb` / `smscoreapi` / `smsdvb`（GPL）をユーザ空間に移植しました。本体は GPL-2.0 です。ファームウェア `isdbt_rio.inp` は `LICENCE.siano` で、改変も再ライセンスもリバースも禁止されています。実行ファイルへ埋め込むと配れないので、Releases ではバイナリの隣にファイルとして置いています。linux-firmware と同じ mere aggregation です。

USB は libusb の API だけを叩きます。Linux の usbfs を直接は触りません。musl でビルドが通ります。Android では `/dev/bus/usb` をアプリから開けないので、渡された fd を `libusb_wrap_sys_device` で受けます。この三つを最初に守らないと、あとの移植が高いです。rtl-sdr と同じ形です。

## 複数 OS は副産物だった

カーネルを捨てた理由はブロックノイズでした。結果として、カーネルモジュールが無い場所でも同じチューナーが開きます。

| | カーネル `smsusb` | `siano-ts` |
|---|---|---|
| 普通の Linux | 動きます。debugfs の WARN と DKMS が残ります | 動きます |
| Home Assistant OS | `CONFIG_SMS_USB_DRV` がありません | 動きます。いまうちの録画はこれです |
| Windows | PLEX のカーネルドライバは HVCI（コア分離）と相性が悪いです | WinUSB（Zadig）で、HVCI を切らずに録画できました |
| macOS | 地デジ USB を開く手段が見当たりません | CI でビルドが通ります。実機は未です |
| Android | 不可です | Termux の `termux-usb -e` で、Google TV Streamer に挿して TS が出ました |

Windows は当初「BonDriver があるから恩恵は小さい」と思っていました。誤りでした。ユーザ空間なら防御を一段下げなくてよいです。WinUSB に載せたデバイスは BonDriver からは見えなくなります。

Android は現状 Termux のみ対応です。Termux が渡す fd を `--fd` で受けます。
APK 版も公開予定です。

macOS は実機を持っていないため未検証です。動作報告・不具合報告お待ちしています。

## 使い方

```sh
./siano-ts --list
./siano-ts --channel 27 -t 30 -o /tmp/nhk.ts
```

mirakc なら、チャンネル定義の `channel` を物理番号にして次のように渡します。

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

B-CAS は recisdb と PC/SC リーダです。decode-filter に置くと、番組表スキャンは生 TS の PAT / SDT を読みます。USB の URB 長は 188 の倍数ではないので、`siano-ts` 側で TS パケット境界に揃えています。ここを揃えないと、mirakc の `scan-services` が空で終わります。

Home Assistant OS 向けには、同じ構成のアドオンも置いてあります。

https://github.com/Khronos31/hassio-addons/tree/main/mirakc

## まだ残っていること

debugfs を外したカーネル経路より、ユーザ空間のほうが安定しました。ゼロにはしていません。3 時間のソークでも、末尾 10 分に僅かなブロックノイズは目視できました。連続性カウンタの飛びをゼロにする作業は、今はしていません。普通のテレビとの比較も合否にしません。

パッケージは本家へ出します。GitHub Releases の tar / zip（バイナリとファームの併置）はこちらで置きます。`.deb` / `.rpm` / `.msi` は作りません。

mirakc への紹介は [issue 3078](https://github.com/mirakc/mirakc/issues/3078) に書きました。本体への取り込み依頼ではありません。tuner command の一例として知っておいてほしい、という起票です。
