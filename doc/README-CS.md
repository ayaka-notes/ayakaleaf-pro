<h1 align="center">
  <br>
  <a href="https://ayakaleaf-pro.ayaka.space"><img src="logo.png" alt="Ayakaleaf Pro" width="300"></a>
</h1>

<h4 align="center">Overleaf Community Edition rozšířená o všechny funkce Pro <br/>(open source, zdarma k použití, s možností vlastního hostování).</h4>

<p align="center">
  <a href="https://ayakaleaf-pro.ayaka.space">Dokumentace</a> •
  <a href="https://github.com/ayaka-notes/ayakaleaf-pro-playground">Playground</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/blog">Blog</a> •
  <a href="https://github.com/orgs/ayaka-notes/packages/container/package/overleaf-pro">Docker image</a> •
  <a href="https://github.com/ayaka-notes/texlive-full">TeXLive</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/dev">Pro vývojáře</a> •
  <a href="#autoři">Autoři</a> •
  <a href="#licence">Licence</a>
</p>

<p align="center">
  <a href="../README.md">English</a> ·
  <b>Čeština</b> ·
  <a href="README-DA.md">Dansk</a> ·
  <a href="README-DE.md">Deutsch</a> ·
  <a href="README-ES.md">Español</a> ·
  <a href="README-FI.md">Suomi</a> ·
  <a href="README-FR.md">Français</a> ·
  <a href="README-IT.md">Italiano</a> ·
  <a href="README-JP.md">日本語</a> ·
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

<img src="screenshot-pro.png" alt="Snímek obrazovky s úpravou projektu v Overleaf Community Edition">
<p align="center">
  Obrázek 1: Snímek obrazovky s úpravou projektu v Ayakaleaf Pro Edition.
</p>

## Ayakaleaf Pro Edition
Ayakaleaf Pro je rozšířená verze Overleaf s téměř všemi funkcemi a možnostmi. Podrobnosti najdete na stránce [Ayakaleaf Pro](https://ayakaleaf-pro.ayaka.space). Ayakaleaf Pro nabízí tyto funkce:

- Obousměrná synchronizace s Dropbox (všechny vaše projekty synchronizované s Dropbox)
- MCP server (AI agenti mohou upravovat, kompilovat a komentovat)
- AI asistent pro chat (chat, úpravy a opravy pomocí AI)
- Asistent chyb (vysvětlení a oprava chyb při kompilaci)
- Import/export přes Pandoc (převod Word, Markdown a LaTeX)
- Spouštění Python skriptů (spouštějte Python ve svém projektu)
- Obousměrná synchronizace s GitHub (Enterprise) (push a pull s GitHub)
- Obousměrná synchronizace s GitLab (GitLab.com nebo vlastní instance GitLab)
- Obousměrná synchronizace s Gitea (Gitea.com nebo vlastní instance Gitea)
- Integrace se Zotero (s podporou Zotero OAuth)
- Integrace s Mendeley (s podporou Mendeley OAuth)
- Pokročilé vyhledávání citací (prohledávání všech vašich Bib záznamů)
- Podpora Git-Bridge (clone, pull a push pomocí Git)
- Administrační panel (globální správa uživatelů a projektů)
- SSO přes LDAP a SAML nebo OAuth 2.0
- Neomezená doba kompilace (nastavitelná v administračním panelu)
- Samoregistrace (volitelná, lze omezit podle e-mailové domény)
- Kompilace v sandboxu (s podporou image [texlive-full](https://github.com/ayaka-notes/texlive-full))
- Systém šablon (s galerií šablon)
- Sledování změn (s panelem pro revize a komentáře)
- Úplná historie projektu (s obnovením a stažením)
- Paleta symbolů (vkládání matematických symbolů jedním kliknutím)
- Úplný i18n překlad (každý text rozhraní v 18 jazycích)
- Podpora ARM (x86_64/arm64 v Docker)

V neposlední řadě je Ayakaleaf Pro open source a lze jej zdarma používat i upravovat. Můžete si jej hostovat sami a přispívat k vývoji Ayakaleaf Pro. Více informací najdete na stránce [Dokumentace pro vývojáře](https://ayakaleaf-pro.ayaka.space/dev).

> [!NOTE]
> Poznámka: Ayakaleaf Pro není nijak spojen se společností Overleaf, Inc. ani s její mateřskou společností Digital Science. Rovněž *nejde o* edici *Server Pro*, což je komerční produkt nabízený společností Overleaf, Inc.
> 
> Ayakaleaf Pro je nezávislý projekt vyvíjený a spravovaný organizací [ayaka-notes](https://github.com/ayaka-notes).

## Instalace

Pokud si chcete Ayakaleaf Pro jen vyzkoušet bez nastavování serveru, můžete použít náš [Ayakaleaf Pro Playground](https://github.com/ayaka-notes/ayakaleaf-pro-playground). Nabízí předkonfigurované prostředí GitHub Codespaces, ve kterém můžete Ayakaleaf Pro spustit a prozkoumat přímo v prohlížeči.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ayaka-notes/ayakaleaf-pro-playground)

Pokud chcete Ayakaleaf Pro nasadit do produkčního provozu, podrobný návod k instalaci najdete na stránce [Dokumentace](https://ayakaleaf-pro.ayaka.space/). Důrazně doporučujeme instalovat Ayakaleaf Pro pomocí [ayaka-notes/Toolkit](https://github.com/ayaka-notes/toolkit/).

## Aktualizace

Pokud aktualizujete z předchozí verze Ayakaleaf Pro, podívejte se na [stránku Releases](https://github.com/ayaka-notes/ayakaleaf-pro/releases), kde najdete změny v každé verzi mezi vaší aktuální verzí a verzí, na kterou přecházíte.

## Překlady

Uvítáme příspěvky k překladům Ayakaleaf Pro. Obecně k překladu anglického textu do dalších jazyků používáme claude/codex. Pokud v překladech najdete chybu, pošlete prosím pull request s opravou. Upravujte prosím pouze příslušné soubory ve složce `services/web/locales/locales_patches`.

Soubory v `services/web/locales/` jsou oficiální překladové soubory Overleaf. Neupravujte je prosím přímo.

## Přispívání

Informace o tom, jak přispět k vývoji Overleaf, najdete v souboru [CONTRIBUTING](../CONTRIBUTING.md).

## Blog
Píšeme o vnitřním fungování Overleaf, výkonu kompilace a infrastruktuře pro vlastní hostování LaTeX. Více si přečtěte na našem blogu:
- [2026.08 Overleaf Server Pro Price and Open-Source Alternative](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-server-pro-price-and-open-source-alternative)
- [2026.08 Overleaf Benchmark: A Deep Research of Concurrent LaTeX Compilation in Overleaf](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-benchmark)

## Autoři

- [Tým Overleaf](https://www.overleaf.com/about)
- [Funkce a autorská práva](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright)

## Licence

Kód v tomto repozitáři je vydán pod licencí GNU AFFERO GENERAL PUBLIC LICENSE, version 3. Její kopii najdete v souboru [`LICENSE`](../LICENSE).

- Copyright (c) Overleaf, 2014-2025.
- Copyright (c) [Pro Authors](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright), 2026-now.

## Sponzoři
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
