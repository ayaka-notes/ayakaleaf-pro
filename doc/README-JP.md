<h1 align="center">
  <br>
  <a href="https://ayakaleaf-pro.ayaka.space"><img src="logo.png" alt="Ayakaleaf Pro" width="300"></a>
</h1>

<h4 align="center">すべての Pro 機能を搭載した Overleaf Community Edition の拡張版 <br/>（オープンソース、無料で利用可能、セルフホスト対応）。</h4>

<p align="center">
  <a href="https://ayakaleaf-pro.ayaka.space">ドキュメント</a> •
  <a href="https://github.com/ayaka-notes/ayakaleaf-pro-playground">Playground</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/blog">ブログ</a> •
  <a href="https://github.com/orgs/ayaka-notes/packages/container/package/overleaf-pro">Docker イメージ</a> •
  <a href="https://github.com/ayaka-notes/texlive-full">TeXLive</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/dev">開発者向け</a> •
  <a href="#作者">作者</a> •
  <a href="#ライセンス">ライセンス</a>
</p>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README-CS.md">Čeština</a> ·
  <a href="README-DA.md">Dansk</a> ·
  <a href="README-DE.md">Deutsch</a> ·
  <a href="README-ES.md">Español</a> ·
  <a href="README-FI.md">Suomi</a> ·
  <a href="README-FR.md">Français</a> ·
  <a href="README-IT.md">Italiano</a> ·
  <b>日本語</b> ·
  <a href="README-KR.md">한국어</a> ·
  <a href="README-NL.md">Nederlands</a> ·
  <a href="README-NO.md">Norsk</a> ·
  <a href="README-PL.md">Polski</a> ·
  <a href="README-PT.md">Português</a> ·
  <a href="README-RU.md">Русский</a> ·
  <a href="README-SV.md">Svenska</a> ·
  <a href="README-TR.md">Türkçe</a> ·
  <a href="README-ZH.md">简体中文</a>
</p>

<img src="screenshot-pro.png" alt="Overleaf Community Edition でプロジェクトを編集している画面のスクリーンショット">
<p align="center">
  図 1：Ayakaleaf Pro Edition でプロジェクトを編集している画面のスクリーンショット。
</p>

## Ayakaleaf Pro Edition
Ayakaleaf Pro は、ほぼすべての機能を備えた Overleaf の拡張版です。詳しくは [Ayakaleaf Pro](https://ayakaleaf-pro.ayaka.space) のページをご覧ください。Ayakaleaf Pro の機能は次のとおりです：

- Dropbox 双方向同期（すべてのプロジェクトを Dropbox と同期）
- MCP サーバー（AI エージェントによる編集・コンパイル・コメント）
- AI チャットアシスタント（AI とのチャット、編集、修正）
- エラーアシスタント（コンパイルエラーの説明と修正）
- Pandoc インポート/エクスポート（Word、Markdown、LaTeX の変換）
- Python スクリプトランナー（プロジェクト内で Python を実行）
- GitHub（Enterprise）双方向同期（GitHub とのプッシュ・プル）
- GitLab 双方向同期（GitLab.com またはセルフホスト GitLab）
- Gitea 双方向同期（Gitea.com またはセルフホスト Gitea）
- Zotero 連携（Zotero OAuth 対応）
- Mendeley 連携（Mendeley OAuth 対応）
- 高度な参考文献検索（すべての Bib エントリを検索）
- Git-Bridge 対応（Git によるクローン・プル・プッシュ）
- 管理パネル（ユーザー/プロジェクトの一元管理）
- LDAP、SAML または OAuth 2.0 による SSO
- コンパイル時間無制限（管理パネルで調整可能）
- セルフ登録（任意、メールドメインで制限可能）
- サンドボックスコンパイル（[texlive-full](https://github.com/ayaka-notes/texlive-full) イメージ対応）
- テンプレートシステム（テンプレートギャラリー付き）
- 変更履歴の記録（レビュー・コメントパネル付き）
- プロジェクトの完全な履歴（復元とダウンロードに対応）
- 記号パレット（ワンクリックで数式記号を挿入）
- 完全な i18n 翻訳（すべての UI 文字列を 18 言語で提供）
- ARM 対応（Docker 上の x86_64/arm64）

最後になりましたが、Ayakaleaf Pro はオープンソースで、無料で利用・改変できます。セルフホストすることも、Ayakaleaf Pro の開発に貢献することもできます。詳しくは [開発者向けドキュメント](https://ayakaleaf-pro.ayaka.space/dev) のページをご覧ください。

> [!NOTE]
> 注意：Ayakaleaf Pro は Overleaf, Inc. およびその親会社である Digital Science とは一切関係ありません。また、Overleaf, Inc. が提供する商用製品である *Server Pro* Edition *でもありません*。
> 
> Ayakaleaf Pro は [ayaka-notes](https://github.com/ayaka-notes) が開発・保守している独立したプロジェクトです。

## インストール

サーバーを構築せずに Ayakaleaf Pro を試したいだけなら、[Ayakaleaf Pro Playground](https://github.com/ayaka-notes/ayakaleaf-pro-playground) をご利用ください。設定済みの GitHub Codespaces 環境が用意されており、ブラウザ上で直接 Ayakaleaf Pro を起動して試すことができます。

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ayaka-notes/ayakaleaf-pro-playground)

本番環境に Ayakaleaf Pro をデプロイしたい場合は、[ドキュメント](https://ayakaleaf-pro.ayaka.space/) ページに詳しいインストール手順があります。Ayakaleaf Pro のインストールには [ayaka-notes/Toolkit](https://github.com/ayaka-notes/toolkit/) の使用を強くおすすめします。

## アップグレード

以前のバージョンの Ayakaleaf Pro からアップグレードする場合は、[Releases ページ](https://github.com/ayaka-notes/ayakaleaf-pro/releases) で、現在のバージョンからアップグレード先のバージョンまでの各バージョンの変更点をご確認ください。

## 翻訳

Ayakaleaf Pro の翻訳への貢献を歓迎します。通常、英語のテキストは claude/codex を使って他の言語に翻訳しています。翻訳に誤りを見つけた場合は、修正のための pull request を送ってください。変更するのは `services/web/locales/locales_patches` フォルダ内の該当ファイルのみにしてください。

`services/web/locales/` 以下のファイルは Overleaf 公式の翻訳ファイルです。直接変更しないでください。

## 貢献

Overleaf の開発への貢献については、[CONTRIBUTING](../CONTRIBUTING.md) ファイルをご覧ください。

## ブログ
Overleaf の内部構造、コンパイル性能、セルフホスト型 LaTeX インフラについて記事を書いています。続きはブログでお読みください：
- [2026.08 Overleaf Server Pro Price and Open-Source Alternative](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-server-pro-price-and-open-source-alternative)
- [2026.08 Overleaf Benchmark: A Deep Research of Concurrent LaTeX Compilation in Overleaf](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-benchmark)

## 作者

- [Overleaf チーム](https://www.overleaf.com/about)
- [機能と著作権](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright)

## ライセンス

このリポジトリのコードは GNU AFFERO GENERAL PUBLIC LICENSE, version 3 のもとで公開されています。ライセンスの写しは [`LICENSE`](../LICENSE) ファイルにあります。

- Copyright (c) Overleaf, 2014-2025.
- Copyright (c) [Pro Authors](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright), 2026-now.

## スポンサー
- [Vultr](https://www.vultr.com/)
- [Linux Do Community](https://linux.do)
- [OpenAI Codex OSS](https://openai.com/en/form/codex-for-oss/)
- [GitBook](https://www.gitbook.com/)

## Star History

<a href="https://www.star-history.com/?repos=ayaka-notes%2Fayakaleaf-pro&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=ayaka-notes/ayakaleaf-pro&type=date&theme=dark&legend=top-left&sealed_token=u3l5zBKFPuzl3y_xdCmqTPT_5iaimMLJchJaALvNsAR3LtSu2NrnvjlmbfGW1NdyDch3XLj-o6rfTpyk2K7s6gtgdzDvrDAsTkBnGz_m2CAkbq0IvxsFXPzEkypDT3vhHvYsvDu3qd7Dx6LcPFy_330a0kqmByAl6FKN-13QCGuo1LTv0iEUihWDTUlz" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=ayaka-notes/ayakaleaf-pro&type=date&legend=top-left&sealed_token=u3l5zBKFPuzl3y_xdCmqTPT_5iaimMLJchJaALvNsAR3LtSu2NrnvjlmbfGW1NdyDch3XLj-o6rfTpyk2K7s6gtgdzDvrDAsTkBnGz_m2CAkbq0IvxsFXPzEkypDT3vhHvYsvDu3qd7Dx6LcPFy_330a0kqmByAl6FKN-13QCGuo1LTv0iEUihWDTUlz" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=ayaka-notes/ayakaleaf-pro&type=date&legend=top-left&sealed_token=u3l5zBKFPuzl3y_xdCmqTPT_5iaimMLJchJaALvNsAR3LtSu2NrnvjlmbfGW1NdyDch3XLj-o6rfTpyk2K7s6gtgdzDvrDAsTkBnGz_m2CAkbq0IvxsFXPzEkypDT3vhHvYsvDu3qd7Dx6LcPFy_330a0kqmByAl6FKN-13QCGuo1LTv0iEUihWDTUlz" />
 </picture>
</a>
