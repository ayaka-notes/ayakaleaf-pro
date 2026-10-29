<h1 align="center">
  <br>
  <a href="https://ayakaleaf-pro.ayaka.space"><img src="logo.png" alt="Ayakaleaf Pro" width="300"></a>
</h1>

<h4 align="center">Overleaf Community Edition utvidet med alle Pro-funksjoner <br/>(åpen kildekode, gratis å bruke, kan driftes selv).</h4>

<p align="center">
  <a href="https://ayakaleaf-pro.ayaka.space">Dokumentasjon</a> •
  <a href="https://github.com/ayaka-notes/ayakaleaf-pro-playground">Playground</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/blog">Blogg</a> •
  <a href="https://github.com/orgs/ayaka-notes/packages/container/package/overleaf-pro">Docker-image</a> •
  <a href="https://github.com/ayaka-notes/texlive-full">TeXLive</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/dev">Utviklere</a> •
  <a href="#forfattere">Forfattere</a> •
  <a href="#lisens">Lisens</a>
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
  <b>Norsk</b> ·
  <a href="README-PL.md">Polski</a> ·
  <a href="README-PT.md">Português</a> ·
  <a href="README-RU.md">Русский</a> ·
  <a href="README-SV.md">Svenska</a> ·
  <a href="README-TR.md">Türkçe</a> ·
  <a href="README-ZH.md">简体中文</a>
</p>

<img src="screenshot-pro.png" alt="Et skjermbilde av et prosjekt som redigeres i Overleaf Community Edition">
<p align="center">
  Figur 1: Et skjermbilde av et prosjekt som redigeres i Ayakaleaf Pro Edition.
</p>

## Ayakaleaf Pro Edition
Ayakaleaf Pro er en utvidet versjon av Overleaf med nesten alle funksjoner og muligheter. Se siden [Ayakaleaf Pro](https://ayakaleaf-pro.ayaka.space) for detaljer. Funksjonene i Ayakaleaf Pro omfatter:

- Toveis synkronisering med Dropbox (hold alle prosjektene dine synkronisert med Dropbox)
- MCP-server (la AI-agenter redigere, kompilere og kommentere)
- AI-chatassistent (chat, rediger og rett med AI)
- Feilassistent (forklar og rett kompileringsfeil)
- Pandoc-import/-eksport (konverter Word, Markdown og LaTeX)
- Python-skriptkjøring (kjør Python i prosjektet ditt)
- Toveis synkronisering med GitHub (Enterprise) (push og pull med GitHub)
- Toveis synkronisering med GitLab (GitLab.com eller selvdriftet GitLab)
- Toveis synkronisering med Gitea (Gitea.com eller selvdriftet Gitea)
- Zotero-integrasjon (med støtte for Zotero OAuth)
- Mendeley-integrasjon (med støtte for Mendeley OAuth)
- Avansert referansesøk (søk i alle Bib-oppføringene dine)
- Støtte for Git-Bridge (clone, pull og push med Git)
- Administrasjonspanel (global administrasjon av brukere og prosjekter)
- SSO med LDAP og SAML eller OAuth 2.0
- Ubegrenset kompileringstid (kan justeres i administrasjonspanelet)
- Selvregistrering (valgfritt, kan begrenses etter e-postdomene)
- Kompilering i sandkasse (med støtte for [texlive-full](https://github.com/ayaka-notes/texlive-full)-imaget)
- Malsystem (med malgalleri)
- Sporing av endringer (med panel for gjennomgang og kommentarer)
- Full prosjekthistorikk (med gjenoppretting og nedlasting)
- Symbolpalett (sett inn matematiske symboler med ett klikk)
- Full i18n-oversettelse (alle tekster i brukergrensesnittet på 18 språk)
- ARM-støtte (x86_64/arm64 på Docker)

Sist, men ikke minst, er Ayakaleaf Pro åpen kildekode og gratis å bruke og endre. Du kan drifte det selv og bidra til utviklingen av Ayakaleaf Pro. Se siden [Utviklerdokumentasjon](https://ayakaleaf-pro.ayaka.space/dev) for flere detaljer.

> [!NOTE]
> Merk: Ayakaleaf Pro er ikke tilknyttet Overleaf, Inc. eller morselskapet Digital Science. Det er heller *ikke Server Pro* Edition, som er et kommersielt produkt fra Overleaf, Inc.
> 
> Ayakaleaf Pro er et uavhengig prosjekt som utvikles og vedlikeholdes av [ayaka-notes](https://github.com/ayaka-notes).

## Installasjon

Hvis du bare vil prøve Ayakaleaf Pro uten å sette opp en server, kan du bruke vår [Ayakaleaf Pro Playground](https://github.com/ayaka-notes/ayakaleaf-pro-playground). Den gir et forhåndskonfigurert GitHub Codespaces-miljø der du kan starte og utforske Ayakaleaf Pro direkte i nettleseren.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ayaka-notes/ayakaleaf-pro-playground)

Hvis du vil ta i bruk Ayakaleaf Pro i produksjon, finner du detaljerte installasjonsinstruksjoner på siden [Dokumentasjon](https://ayakaleaf-pro.ayaka.space/). Vi anbefaler på det sterkeste å installere Ayakaleaf Pro med [ayaka-notes/Toolkit](https://github.com/ayaka-notes/toolkit/).

## Oppgradering

Hvis du oppgraderer fra en tidligere versjon av Ayakaleaf Pro, kan du se endringene i hver versjon mellom din nåværende versjon og den du oppgraderer til, på [Releases-siden](https://github.com/ayaka-notes/ayakaleaf-pro/releases).

## Oversettelser

Vi tar gjerne imot bidrag til oversettelsene av Ayakaleaf Pro. Vanligvis bruker vi claude/codex til å oversette den engelske teksten til andre språk. Hvis du finner feil i oversettelsene, kan du sende inn en pull request for å rette dem. Endre bare de relevante filene i mappen `services/web/locales/locales_patches`.

Filene under `services/web/locales/` er Overleafs offisielle oversettelsesfiler. Ikke endre dem direkte.

## Bidra

Se filen [CONTRIBUTING](../CONTRIBUTING.md) for informasjon om hvordan du kan bidra til utviklingen av Overleaf.

## Blogg
Vi skriver om hvordan Overleaf fungerer internt, kompileringsytelse og selvdriftet LaTeX-infrastruktur. Les mer på bloggen vår:
- [2026.08 Overleaf Server Pro Price and Open-Source Alternative](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-server-pro-price-and-open-source-alternative)
- [2026.08 Overleaf Benchmark: A Deep Research of Concurrent LaTeX Compilation in Overleaf](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-benchmark)

## Forfattere

- [Overleaf-teamet](https://www.overleaf.com/about)
- [Funksjoner og opphavsrett](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright)

## Lisens

Koden i dette repositoriet er utgitt under GNU AFFERO GENERAL PUBLIC LICENSE, version 3. En kopi finnes i filen [`LICENSE`](../LICENSE).

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
