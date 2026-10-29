<h1 align="center">
  <br>
  <a href="https://ayakaleaf-pro.ayaka.space"><img src="logo.png" alt="Ayakaleaf Pro" width="300"></a>
</h1>

<h4 align="center">Overleaf Community Edition potenziato con tutte le funzionalità Pro <br/>(open source, gratuito, installabile sul proprio server).</h4>

<p align="center">
  <a href="https://ayakaleaf-pro.ayaka.space">Documentazione</a> •
  <a href="https://github.com/ayaka-notes/ayakaleaf-pro-playground">Playground</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/blog">Blog</a> •
  <a href="https://github.com/orgs/ayaka-notes/packages/container/package/overleaf-pro">Immagine Docker</a> •
  <a href="https://github.com/ayaka-notes/texlive-full">TeXLive</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/dev">Sviluppatori</a> •
  <a href="#autori">Autori</a> •
  <a href="#licenza">Licenza</a>
</p>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README-CS.md">Čeština</a> ·
  <a href="README-DA.md">Dansk</a> ·
  <a href="README-DE.md">Deutsch</a> ·
  <a href="README-ES.md">Español</a> ·
  <a href="README-FI.md">Suomi</a> ·
  <a href="README-FR.md">Français</a> ·
  <b>Italiano</b> ·
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

<img src="screenshot-pro.png" alt="Screenshot di un progetto in modifica in Overleaf Community Edition">
<p align="center">
  Figura 1: screenshot di un progetto in modifica in Ayakaleaf Pro Edition.
</p>

## Ayakaleaf Pro Edition
Ayakaleaf Pro è una versione potenziata di Overleaf con quasi tutte le funzionalità e capacità. Per i dettagli, consulta la pagina [Ayakaleaf Pro](https://ayakaleaf-pro.ayaka.space). Le funzionalità di Ayakaleaf Pro includono:

- Sincronizzazione bidirezionale con Dropbox (mantieni tutti i tuoi progetti sincronizzati con Dropbox)
- Server MCP (permetti agli agenti IA di modificare, compilare e commentare)
- Assistente chat IA (chatta, modifica e correggi con l'IA)
- Assistente errori (spiega e corregge gli errori di compilazione)
- Importazione/esportazione Pandoc (converti Word, Markdown e LaTeX)
- Esecuzione di script Python (esegui Python nel tuo progetto)
- Sincronizzazione bidirezionale con GitHub (Enterprise) (push e pull con GitHub)
- Sincronizzazione bidirezionale con GitLab (GitLab.com o GitLab self-hosted)
- Sincronizzazione bidirezionale con Gitea (Gitea.com o Gitea self-hosted)
- Integrazione con Zotero (con supporto OAuth per Zotero)
- Integrazione con Mendeley (con supporto OAuth per Mendeley)
- Ricerca avanzata dei riferimenti (cerca in tutte le tue voci bib)
- Supporto Git-Bridge (clone, pull e push con Git)
- Pannello di amministrazione (gestione globale di utenti/progetti)
- SSO con LDAP e SAML oppure OAuth 2.0
- Tempo di compilazione illimitato (regolabile nel pannello di amministrazione)
- Registrazione autonoma (facoltativa, limitabile per dominio email)
- Compilazione in sandbox (con supporto per l'immagine [texlive-full](https://github.com/ayaka-notes/texlive-full))
- Sistema di modelli (con galleria di modelli)
- Revisione delle modifiche (con pannello di revisione e commenti)
- Cronologia completa del progetto (con ripristino e download)
- Tavolozza dei simboli (inserisci simboli matematici con un clic)
- Traduzione i18n completa (ogni testo dell'interfaccia in 18 lingue)
- Supporto ARM (x86_64/arm64 su Docker)

Infine, ma non meno importante, Ayakaleaf Pro è open source, gratuito da usare e modificare. Puoi installarlo sul tuo server e contribuire allo sviluppo di Ayakaleaf Pro. Per maggiori dettagli, consulta la pagina [Documentazione per sviluppatori](https://ayakaleaf-pro.ayaka.space/dev).

> [!NOTE]
> Nota: Ayakaleaf Pro non è affiliato a Overleaf, Inc. né alla sua società madre, Digital Science. Inoltre *non è l'edizione Server Pro*, che è un prodotto commerciale offerto da Overleaf, Inc.
> 
> Ayakaleaf Pro è un progetto indipendente sviluppato e mantenuto da [ayaka-notes](https://github.com/ayaka-notes).

## Installazione

Se vuoi solo provare Ayakaleaf Pro senza configurare un server, puoi usare il nostro [Ayakaleaf Pro Playground](https://github.com/ayaka-notes/ayakaleaf-pro-playground). Fornisce un ambiente GitHub Codespaces preconfigurato che ti permette di avviare ed esplorare Ayakaleaf Pro direttamente nel browser.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ayaka-notes/ayakaleaf-pro-playground)

Se vuoi distribuire Ayakaleaf Pro in produzione, trovi istruzioni di installazione dettagliate nella pagina [Documentazione](https://ayakaleaf-pro.ayaka.space/). Consigliamo vivamente di installare Ayakaleaf Pro con il [ayaka-notes/Toolkit](https://github.com/ayaka-notes/toolkit/).

## Aggiornamento

Se stai aggiornando da una versione precedente di Ayakaleaf Pro, consulta la [pagina delle release](https://github.com/ayaka-notes/ayakaleaf-pro/releases) per le modifiche di ciascuna versione tra quella attuale e quella a cui stai aggiornando.

## Traduzioni

I contributi alle traduzioni di Ayakaleaf Pro sono benvenuti. In genere usiamo claude/codex per tradurre il testo inglese nelle altre lingue. Se trovi errori nelle traduzioni, invia una pull request per correggerli. Modifica solo i file pertinenti nella cartella `services/web/locales/locales_patches`.

I file in `services/web/locales/` sono i file di traduzione ufficiali di Overleaf. Non modificarli direttamente.

## Contribuire

Consulta il file [CONTRIBUTING](../CONTRIBUTING.md) per informazioni su come contribuire allo sviluppo di Overleaf.

## Blog
Scriviamo del funzionamento interno di Overleaf, delle prestazioni di compilazione e dell'infrastruttura LaTeX self-hosted. Leggi di più sul nostro blog:
- [2026.08 Overleaf Server Pro Price and Open-Source Alternative](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-server-pro-price-and-open-source-alternative)
- [2026.08 Overleaf Benchmark: A Deep Research of Concurrent LaTeX Compilation in Overleaf](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-benchmark)

## Autori

- [Il team di Overleaf](https://www.overleaf.com/about)
- [Funzionalità e copyright](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright)

## Licenza

Il codice di questo repository è rilasciato sotto la GNU AFFERO GENERAL PUBLIC LICENSE, version 3. Una copia si trova nel file [`LICENSE`](../LICENSE).

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
