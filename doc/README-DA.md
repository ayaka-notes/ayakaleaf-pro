<h1 align="center">
  <br>
  <a href="https://ayakaleaf-pro.ayaka.space"><img src="logo.png" alt="Ayakaleaf Pro" width="300"></a>
</h1>

<h4 align="center">Overleaf Community Edition udvidet med alle Pro-funktioner <br/>(open source, gratis at bruge, kan selvhostes).</h4>

<p align="center">
  <a href="https://ayakaleaf-pro.ayaka.space">Dokumentation</a> •
  <a href="https://github.com/ayaka-notes/ayakaleaf-pro-playground">Playground</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/blog">Blog</a> •
  <a href="https://github.com/orgs/ayaka-notes/packages/container/package/overleaf-pro">Docker-image</a> •
  <a href="https://github.com/ayaka-notes/texlive-full">TeXLive</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/dev">Udviklere</a> •
  <a href="#forfattere">Forfattere</a> •
  <a href="#licens">Licens</a>
</p>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README-CS.md">Čeština</a> ·
  <b>Dansk</b> ·
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

<img src="screenshot-pro.png" alt="Et skærmbillede af et projekt, der redigeres i Overleaf Community Edition">
<p align="center">
  Figur 1: Et skærmbillede af et projekt, der redigeres i Ayakaleaf Pro Edition.
</p>

## Ayakaleaf Pro Edition
Ayakaleaf Pro er en udvidet version af Overleaf med næsten alle funktioner og muligheder. Se siden [Ayakaleaf Pro](https://ayakaleaf-pro.ayaka.space) for detaljer. Funktionerne i Ayakaleaf Pro omfatter:

- Tovejssynkronisering med Dropbox (hold alle dine projekter synkroniseret med Dropbox)
- MCP-server (lad AI-agenter redigere, kompilere og kommentere)
- AI-chatassistent (chat, rediger og ret med AI)
- Fejlassistent (forklar og ret kompileringsfejl)
- Pandoc-import/-eksport (konverter Word, Markdown og LaTeX)
- Python-scriptkørsel (kør Python i dit projekt)
- Tovejssynkronisering med GitHub (Enterprise) (push og pull med GitHub)
- Tovejssynkronisering med GitLab (GitLab.com eller selvhostet GitLab)
- Tovejssynkronisering med Gitea (Gitea.com eller selvhostet Gitea)
- Zotero-integration (med understøttelse af Zotero OAuth)
- Mendeley-integration (med understøttelse af Mendeley OAuth)
- Avanceret referencesøgning (søg i alle dine Bib-poster)
- Understøttelse af Git-Bridge (clone, pull og push med Git)
- Administrationspanel (global administration af brugere og projekter)
- SSO med LDAP og SAML eller OAuth 2.0
- Ubegrænset kompileringstid (kan justeres i administrationspanelet)
- Selvregistrering (valgfri, kan begrænses efter maildomæne)
- Kompilering i sandkasse (med understøttelse af [texlive-full](https://github.com/ayaka-notes/texlive-full)-imaget)
- Skabelonsystem (med skabelongalleri)
- Sporing af ændringer (med panel til gennemgang og kommentarer)
- Fuld projekthistorik (med gendannelse og download)
- Symbolpalet (indsæt matematiske symboler med ét klik)
- Fuld i18n-oversættelse (alle tekster i brugerfladen på 18 sprog)
- ARM-understøttelse (x86_64/arm64 på Docker)

Sidst, men ikke mindst, er Ayakaleaf Pro open source og gratis at bruge og ændre. Du kan selvhoste det og bidrage til udviklingen af Ayakaleaf Pro. Se siden [Udviklerdokumentation](https://ayakaleaf-pro.ayaka.space/dev) for flere detaljer.

> [!NOTE]
> Bemærk: Ayakaleaf Pro er ikke tilknyttet Overleaf, Inc. eller dets moderselskab, Digital Science. Det er heller *ikke Server Pro* Edition, som er et kommercielt produkt fra Overleaf, Inc.
> 
> Ayakaleaf Pro er et uafhængigt projekt, der udvikles og vedligeholdes af [ayaka-notes](https://github.com/ayaka-notes).

## Installation

Hvis du bare vil prøve Ayakaleaf Pro uden at opsætte en server, kan du bruge vores [Ayakaleaf Pro Playground](https://github.com/ayaka-notes/ayakaleaf-pro-playground). Det giver et forudkonfigureret GitHub Codespaces-miljø, hvor du kan starte og udforske Ayakaleaf Pro direkte i din browser.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ayaka-notes/ayakaleaf-pro-playground)

Hvis du vil udrulle Ayakaleaf Pro til produktionsbrug, finder du detaljerede installationsvejledninger på siden [Dokumentation](https://ayakaleaf-pro.ayaka.space/). Vi anbefaler kraftigt at installere Ayakaleaf Pro med [ayaka-notes/Toolkit](https://github.com/ayaka-notes/toolkit/).

## Opgradering

Hvis du opgraderer fra en tidligere version af Ayakaleaf Pro, kan du se ændringerne i hver version mellem din nuværende version og den, du opgraderer til, på [siden Releases](https://github.com/ayaka-notes/ayakaleaf-pro/releases).

## Oversættelser

Vi tager gerne imod bidrag til oversættelserne af Ayakaleaf Pro. Generelt bruger vi claude/codex til at oversætte den engelske tekst til andre sprog. Hvis du finder fejl i oversættelserne, så indsend venligst en pull request for at rette dem. Ret venligst kun de relevante filer i mappen `services/web/locales/locales_patches`.

Filerne under `services/web/locales/` er Overleafs officielle oversættelsesfiler. Ret venligst ikke direkte i dem.

## Bidrag

Se filen [CONTRIBUTING](../CONTRIBUTING.md) for information om, hvordan du bidrager til udviklingen af Overleaf.

## Blog
Vi skriver om Overleafs interne opbygning, kompileringsydelse og selvhostet LaTeX-infrastruktur. Læs mere på vores blog:
- [2026.08 Overleaf Server Pro Price and Open-Source Alternative](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-server-pro-price-and-open-source-alternative)
- [2026.08 Overleaf Benchmark: A Deep Research of Concurrent LaTeX Compilation in Overleaf](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-benchmark)

## Forfattere

- [Overleaf-teamet](https://www.overleaf.com/about)
- [Funktioner og ophavsret](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright)

## Licens

Koden i dette repository er udgivet under GNU AFFERO GENERAL PUBLIC LICENSE, version 3. En kopi findes i filen [`LICENSE`](../LICENSE).

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
