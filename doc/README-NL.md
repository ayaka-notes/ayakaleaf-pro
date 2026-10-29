<h1 align="center">
  <br>
  <a href="https://ayakaleaf-pro.ayaka.space"><img src="logo.png" alt="Ayakaleaf Pro" width="300"></a>
</h1>

<h4 align="center">Overleaf Community Edition uitgebreid met alle Pro-functies <br/>(open source, gratis te gebruiken, zelf te hosten).</h4>

<p align="center">
  <a href="https://ayakaleaf-pro.ayaka.space">Documentatie</a> •
  <a href="https://github.com/ayaka-notes/ayakaleaf-pro-playground">Playground</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/blog">Blog</a> •
  <a href="https://github.com/orgs/ayaka-notes/packages/container/package/overleaf-pro">Docker-image</a> •
  <a href="https://github.com/ayaka-notes/texlive-full">TeXLive</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/dev">Ontwikkelaars</a> •
  <a href="#auteurs">Auteurs</a> •
  <a href="#licentie">Licentie</a>
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
  <a href="README-JP.md">日本語</a> ·
  <a href="README-KR.md">한국어</a> ·
  <b>Nederlands</b> ·
  <a href="README-NO.md">Norsk</a> ·
  <a href="README-PL.md">Polski</a> ·
  <a href="README-PT.md">Português</a> ·
  <a href="README-RU.md">Русский</a> ·
  <a href="README-SV.md">Svenska</a> ·
  <a href="README-TR.md">Türkçe</a> ·
  <a href="README-ZH.md">简体中文</a>
</p>

<img src="screenshot-pro.png" alt="Een schermafbeelding van een project dat wordt bewerkt in Overleaf Community Edition">
<p align="center">
  Figuur 1: Een schermafbeelding van een project dat wordt bewerkt in Ayakaleaf Pro Edition.
</p>

## Ayakaleaf Pro Edition
Ayakaleaf Pro is een uitgebreide versie van Overleaf met vrijwel alle functies en mogelijkheden. Zie voor details de pagina [Ayakaleaf Pro](https://ayakaleaf-pro.ayaka.space). Functies in Ayakaleaf Pro zijn onder andere:

- Tweerichtingssynchronisatie met Dropbox (houd al je projecten gesynchroniseerd met Dropbox)
- MCP-server (laat AI-agents bewerken, compileren en opmerkingen plaatsen)
- AI-chatassistent (chatten, bewerken en corrigeren met AI)
- Foutenassistent (compileerfouten uitleggen en oplossen)
- Pandoc-import/-export (Word, Markdown en LaTeX converteren)
- Python-scriptrunner (Python uitvoeren in je project)
- Tweerichtingssynchronisatie met GitHub (Enterprise) (pushen en pullen met GitHub)
- Tweerichtingssynchronisatie met GitLab (GitLab.com of zelf gehoste GitLab)
- Tweerichtingssynchronisatie met Gitea (Gitea.com of zelf gehoste Gitea)
- Zotero-integratie (met ondersteuning voor Zotero OAuth)
- Mendeley-integratie (met ondersteuning voor Mendeley OAuth)
- Geavanceerd zoeken naar referenties (doorzoek al je Bib-items)
- Ondersteuning voor Git-Bridge (klonen, pullen en pushen met Git)
- Beheerpaneel (globaal beheer van gebruikers en projecten)
- SSO met LDAP en SAML of OAuth 2.0
- Onbeperkte compilatietijd (instelbaar in het beheerpaneel)
- Zelfregistratie (optioneel, te beperken op e-maildomein)
- Compileren in een sandbox (met ondersteuning voor de [texlive-full](https://github.com/ayaka-notes/texlive-full)-image)
- Sjabloonsysteem (met sjabloongalerij)
- Wijzigingen bijhouden (met paneel voor review en opmerkingen)
- Volledige projectgeschiedenis (met herstellen en downloaden)
- Symbolenpalet (wiskundige symbolen met één klik invoegen)
- Volledige i18n-vertaling (elke tekst in de interface in 18 talen)
- ARM-ondersteuning (x86_64/arm64 op Docker)

Tot slot: Ayakaleaf Pro is open source en gratis te gebruiken en aan te passen. Je kunt het zelf hosten en bijdragen aan de ontwikkeling van Ayakaleaf Pro. Zie voor meer details de pagina [Ontwikkelaarsdocumentatie](https://ayakaleaf-pro.ayaka.space/dev).

> [!NOTE]
> Opmerking: Ayakaleaf Pro is niet gelieerd aan Overleaf, Inc. of aan het moederbedrijf daarvan, Digital Science. Het is ook *niet de Server Pro* Edition, een commercieel product van Overleaf, Inc.
> 
> Ayakaleaf Pro is een onafhankelijk project dat wordt ontwikkeld en onderhouden door [ayaka-notes](https://github.com/ayaka-notes).

## Installatie

Als je Ayakaleaf Pro alleen wilt uitproberen zonder een server op te zetten, kun je onze [Ayakaleaf Pro Playground](https://github.com/ayaka-notes/ayakaleaf-pro-playground) gebruiken. Deze biedt een vooraf geconfigureerde GitHub Codespaces-omgeving waarmee je Ayakaleaf Pro direct in je browser kunt starten en verkennen.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ayaka-notes/ayakaleaf-pro-playground)

Als je Ayakaleaf Pro in productie wilt gebruiken, vind je uitgebreide installatie-instructies op de pagina [Documentatie](https://ayakaleaf-pro.ayaka.space/). We raden ten zeerste aan om Ayakaleaf Pro te installeren met de [ayaka-notes/Toolkit](https://github.com/ayaka-notes/toolkit/).

## Upgraden

Als je upgradet vanaf een eerdere versie van Ayakaleaf Pro, bekijk dan de [Releases-pagina](https://github.com/ayaka-notes/ayakaleaf-pro/releases) voor de wijzigingen in elke versie tussen je huidige versie en de versie waarnaar je upgradet.

## Vertalingen

Bijdragen aan de vertalingen van Ayakaleaf Pro zijn welkom. Over het algemeen gebruiken we claude/codex om de Engelse tekst naar andere talen te vertalen. Als je fouten in de vertalingen vindt, dien dan een pull request in om ze te corrigeren. Pas alleen de relevante bestanden in de map `services/web/locales/locales_patches` aan.

Bestanden in `services/web/locales/` zijn de officiële vertaalbestanden van Overleaf. Pas deze niet rechtstreeks aan.

## Bijdragen

Zie het bestand [CONTRIBUTING](../CONTRIBUTING.md) voor informatie over bijdragen aan de ontwikkeling van Overleaf.

## Blog
We schrijven over de interne werking van Overleaf, compilatieprestaties en zelf gehoste LaTeX-infrastructuur. Lees meer op onze blog:
- [2026.08 Overleaf Server Pro Price and Open-Source Alternative](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-server-pro-price-and-open-source-alternative)
- [2026.08 Overleaf Benchmark: A Deep Research of Concurrent LaTeX Compilation in Overleaf](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-benchmark)

## Auteurs

- [Het Overleaf-team](https://www.overleaf.com/about)
- [Functies en auteursrecht](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright)

## Licentie

De code in deze repository wordt uitgebracht onder de GNU AFFERO GENERAL PUBLIC LICENSE, version 3. Een kopie staat in het bestand [`LICENSE`](../LICENSE).

- Copyright (c) Overleaf, 2014-2025.
- Copyright (c) [Pro Authors](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright), 2026-now.

## Sponsor
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
