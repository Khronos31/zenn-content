---
title: "Home AssistantでCANDY HOUSE SESAMEをローカル操作するIntegrationを自作したら車輪の再発明だった"
emoji: "🔑"
type: "tech"
topics: ["homeassistant", "esphome", "bluetooth", "sesame", "hacs"]
published: true
qiita_published: true
---

## 何を作ったか

https://github.com/Khronos31/home-assistant-candy-house-ble

## 先行実装

https://github.com/homy-newfs8/esphome-sesame3

https://github.com/homy-newfs8/esphome-sesame_server

## 類似点・相違点

### 類似点

- どれもクラウドAPIを使わず、Bluetooth LEでSESAMEを扱う
- `esphome-sesame3`はSESAME本体をESPHomeから操作する
- `esphome-sesame_server`はSESAME 5を偽装し、RemoteやTouchをボタンとして扱う
- `home-assistant-candy-house-ble`にもSESAME本体の操作とFake SESAMEボタン機能がある

### 相違点

- 既存実装はESPHome側で処理し、自作IntegrationはHome Assistant側で処理する
- 自作IntegrationはHA Bluetooth / Bluetooth Proxyに対応している
- 自作Integrationには共有QRのHA内デコード、Bot 2のスクリプト操作、診断情報、RemoteやTouchのイベントエンティティ化がある

## なぜ見つけられなかったか

Home Assistant HACS SESAME とかで調べたので、ESPHome 実装を見つけそびれた。
古い統合や、クラウドAPI を利用する統合の実装例を見つけて、先行実装はないと判断した。
エージェントに先行実装を調べさせるのを忘れた。

## どうすればよかったか

GitHubを自力で検索して、エージェントにもWebSearchをお願いする(プロジェクト開始のためのSkillを作成しましたが、それはまた別の記事で)

## おわりに

作ったものが無駄だったのもつらいし、自作のIntegrationに慣れてしまったせいで、実績ある先行実装に乗り換えられないのもつらい
