<h1 align="center">
  <br>
  <a href="https://ayakaleaf-pro.ayaka.space"><img src="logo.png" alt="Ayakaleaf Pro" width="300"></a>
</h1>

<h4 align="center">Overleaf Community Edition utökad med alla Pro-funktioner <br/>(öppen källkod, gratis att använda, kan driftas själv).</h4>

<p align="center">
  <a href="https://ayakaleaf-pro.ayaka.space">Dokumentation</a> •
  <a href="https://github.com/ayaka-notes/ayakaleaf-pro-playground">Playground</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/blog">Blogg</a> •
  <a href="https://github.com/orgs/ayaka-notes/packages/container/package/overleaf-pro">Docker-avbild</a> •
  <a href="https://github.com/ayaka-notes/texlive-full">TeXLive</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/dev">Utvecklare</a> •
  <a href="#författare">Författare</a> •
  <a href="#licens">Licens</a>
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
  <a href="README-NL.md">Nederlands</a> ·
  <a href="README-NO.md">Norsk</a> ·
  <a href="README-PL.md">Polski</a> ·
  <a href="README-PT.md">Português</a> ·
  <a href="README-RU.md">Русский</a> ·
  <b>Svenska</b> ·
  <a href="README-TR.md">Türkçe</a> ·
  <a href="README-ZH.md">简体中文</a>
</p>

<img src="screenshot-pro.png" alt="En skärmbild av ett projekt som redigeras i Overleaf Community Edition">
<p align="center">
  Figur 1: En skärmbild av ett projekt som redigeras i Ayakaleaf Pro Edition.
</p>

## Ayakaleaf Pro Edition
Ayakaleaf Pro är en utökad version av Overleaf med nästan alla funktioner och möjligheter. Mer information finns på sidan [Ayakaleaf Pro](https://ayakaleaf-pro.ayaka.space). Funktionerna i Ayakaleaf Pro omfattar:

- Dubbelriktad synkronisering med Dropbox (håll alla dina projekt synkroniserade med Dropbox)
- MCP-server (låt AI-agenter redigera, kompilera och kommentera)
- AI-chattassistent (chatta, redigera och rätta med AI)
- Felassistent (förklara och åtgärda kompileringsfel)
- Pandoc-import/-export (konvertera Word, Markdown och LaTeX)
- Python-skriptkörning (kör Python i ditt projekt)
- Dubbelriktad synkronisering med GitHub (Enterprise) (push och pull med GitHub)
- Dubbelriktad synkronisering med GitLab (GitLab.com eller egendriftad GitLab)
- Dubbelriktad synkronisering med Gitea (Gitea.com eller egendriftad Gitea)
- Zotero-integration (med stöd för Zotero OAuth)
- Mendeley-integration (med stöd för Mendeley OAuth)
- Avancerad referenssökning (sök i alla dina Bib-poster)
- Stöd för Git-Bridge (clone, pull och push med Git)
- Administratörspanel (global hantering av användare och projekt)
- SSO med LDAP och SAML eller OAuth 2.0
- Obegränsad kompileringstid (justerbar i administratörspanelen)
- Självregistrering (valfri, kan begränsas efter e-postdomän)
- Kompilering i sandlåda (med stöd för avbilden [texlive-full](https://github.com/ayaka-notes/texlive-full))
- Mallsystem (med mallgalleri)
- Spåra ändringar (med panel för granskning och kommentarer)
- Fullständig projekthistorik (med återställning och nedladdning)
- Symbolpalett (infoga matematiska symboler med ett klick)
- Fullständig i18n-översättning (alla texter i gränssnittet på 18 språk)
- ARM-stöd (x86_64/arm64 på Docker)

Sist men inte minst är Ayakaleaf Pro öppen källkod och gratis att använda och ändra. Du kan drifta det själv och bidra till utvecklingen av Ayakaleaf Pro. Mer information finns på sidan [Utvecklardokumentation](https://ayakaleaf-pro.ayaka.space/dev).

> [!NOTE]
> Obs! Ayakaleaf Pro är inte knutet till Overleaf, Inc. eller dess moderbolag Digital Science. Det är heller *inte Server Pro* Edition, som är en kommersiell produkt från Overleaf, Inc.
> 
> Ayakaleaf Pro är ett oberoende projekt som utvecklas och underhålls av [ayaka-notes](https://github.com/ayaka-notes).

## Installation

Om du bara vill prova Ayakaleaf Pro utan att sätta upp en server kan du använda vår [Ayakaleaf Pro Playground](https://github.com/ayaka-notes/ayakaleaf-pro-playground). Den erbjuder en förkonfigurerad GitHub Codespaces-miljö där du kan starta och utforska Ayakaleaf Pro direkt i webbläsaren.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ayaka-notes/ayakaleaf-pro-playground)

Om du vill driftsätta Ayakaleaf Pro i produktion finns detaljerade installationsanvisningar på sidan [Dokumentation](https://ayakaleaf-pro.ayaka.space/). Vi rekommenderar starkt att du installerar Ayakaleaf Pro med [ayaka-notes/Toolkit](https://github.com/ayaka-notes/toolkit/).

## Uppgradering

Om du uppgraderar från en tidigare version av Ayakaleaf Pro, se [sidan Releases](https://github.com/ayaka-notes/ayakaleaf-pro/releases) för ändringarna i varje version mellan din nuvarande version och den du uppgraderar till.

## Översättningar

Vi välkomnar bidrag till översättningarna av Ayakaleaf Pro. I regel använder vi claude/codex för att översätta den engelska texten till andra språk. Om du hittar fel i översättningarna, skicka gärna en pull request för att rätta dem. Ändra endast de relevanta filerna i mappen `services/web/locales/locales_patches`.

Filerna under `services/web/locales/` är Overleafs officiella översättningsfiler. Ändra inte dem direkt.

## Bidra

Se filen [CONTRIBUTING](../CONTRIBUTING.md) för information om hur du bidrar till utvecklingen av Overleaf.

## Blogg
Vi skriver om hur Overleaf fungerar internt, kompileringsprestanda och egendriftad LaTeX-infrastruktur. Läs mer på vår blogg:
- [2026.08 Overleaf Server Pro Price and Open-Source Alternative](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-server-pro-price-and-open-source-alternative)
- [2026.08 Overleaf Benchmark: A Deep Research of Concurrent LaTeX Compilation in Overleaf](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-benchmark)

## Författare

- [Overleaf-teamet](https://www.overleaf.com/about)
- [Funktioner och upphovsrätt](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright)

## Licens

Koden i detta repository släpps under GNU AFFERO GENERAL PUBLIC LICENSE, version 3. En kopia finns i filen [`LICENSE`](../LICENSE).

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
