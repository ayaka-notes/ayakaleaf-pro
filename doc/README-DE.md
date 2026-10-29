<h1 align="center">
  <br>
  <a href="https://ayakaleaf-pro.ayaka.space"><img src="logo.png" alt="Ayakaleaf Pro" width="300"></a>
</h1>

<h4 align="center">Overleaf Community Edition, erweitert um alle Pro-Funktionen <br/>(Open Source, kostenlos nutzbar, selbst hostbar).</h4>

<p align="center">
  <a href="https://ayakaleaf-pro.ayaka.space">Dokumentation</a> •
  <a href="https://github.com/ayaka-notes/ayakaleaf-pro-playground">Playground</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/blog">Blog</a> •
  <a href="https://github.com/orgs/ayaka-notes/packages/container/package/overleaf-pro">Docker-Image</a> •
  <a href="https://github.com/ayaka-notes/texlive-full">TeXLive</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/dev">Entwickler</a> •
  <a href="#autoren">Autoren</a> •
  <a href="#lizenz">Lizenz</a>
</p>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README-CS.md">Čeština</a> ·
  <a href="README-DA.md">Dansk</a> ·
  <b>Deutsch</b> ·
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

<img src="screenshot-pro.png" alt="Screenshot eines Projekts, das in Overleaf Community Edition bearbeitet wird">
<p align="center">
  Abbildung 1: Screenshot eines Projekts, das in der Ayakaleaf Pro Edition bearbeitet wird.
</p>

## Ayakaleaf Pro Edition
Ayakaleaf Pro ist eine erweiterte Version von Overleaf mit nahezu allen Funktionen und Möglichkeiten. Details finden Sie auf der Seite [Ayakaleaf Pro](https://ayakaleaf-pro.ayaka.space). Zu den Funktionen von Ayakaleaf Pro gehören:

- Bidirektionale Dropbox-Synchronisierung (alle Ihre Projekte mit Dropbox synchron halten)
- MCP-Server (KI-Agenten bearbeiten, kompilieren und kommentieren lassen)
- KI-Chat-Assistent (mit KI chatten, bearbeiten und korrigieren)
- Fehlerassistent (Kompilierfehler erklären und beheben)
- Pandoc-Import/-Export (Word, Markdown und LaTeX konvertieren)
- Python-Skriptausführung (Python in Ihrem Projekt ausführen)
- Bidirektionale GitHub(Enterprise)-Synchronisierung (mit GitHub pushen und pullen)
- Bidirektionale GitLab-Synchronisierung (GitLab.com oder selbst gehostetes GitLab)
- Bidirektionale Gitea-Synchronisierung (Gitea.com oder selbst gehostetes Gitea)
- Zotero-Integration (mit Zotero-OAuth-Unterstützung)
- Mendeley-Integration (mit Mendeley-OAuth-Unterstützung)
- Erweiterte Literatursuche (alle Ihre Bib-Einträge durchsuchen)
- Git-Bridge-Unterstützung (mit Git klonen, pullen und pushen)
- Admin-Panel (globale Verwaltung von Benutzern/Projekten)
- SSO mit LDAP und SAML oder OAuth 2.0
- Unbegrenzte Kompilierzeit (im Admin-Panel einstellbar)
- Selbstregistrierung (optional, auf E-Mail-Domains beschränkbar)
- Sandbox-Kompilierung (mit Unterstützung für das [texlive-full](https://github.com/ayaka-notes/texlive-full)-Image)
- Vorlagensystem (mit Vorlagengalerie)
- Änderungsverfolgung (mit Review- und Kommentarbereich)
- Vollständiger Projektverlauf (mit Wiederherstellen und Herunterladen)
- Symbolpalette (mathematische Symbole mit einem Klick einfügen)
- Vollständige i18n-Übersetzung (jeder UI-Text in 18 Sprachen)
- ARM-Unterstützung (x86_64/arm64 unter Docker)

Nicht zuletzt ist Ayakaleaf Pro Open Source und kann kostenlos genutzt und verändert werden. Sie können es selbst hosten und zur Entwicklung von Ayakaleaf Pro beitragen. Weitere Details finden Sie auf der Seite [Entwicklerdokumentation](https://ayakaleaf-pro.ayaka.space/dev).

> [!NOTE]
> Hinweis: Ayakaleaf Pro steht in keiner Verbindung zu Overleaf, Inc. oder dessen Muttergesellschaft Digital Science. Es ist außerdem *nicht die Server Pro* Edition, ein kommerzielles Produkt von Overleaf, Inc.
> 
> Ayakaleaf Pro ist ein unabhängiges Projekt, das von [ayaka-notes](https://github.com/ayaka-notes) entwickelt und gepflegt wird.

## Installation

Wenn Sie Ayakaleaf Pro nur ausprobieren möchten, ohne einen Server einzurichten, können Sie unseren [Ayakaleaf Pro Playground](https://github.com/ayaka-notes/ayakaleaf-pro-playground) verwenden. Er stellt eine vorkonfigurierte GitHub-Codespaces-Umgebung bereit, mit der Sie Ayakaleaf Pro direkt im Browser starten und erkunden können.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ayaka-notes/ayakaleaf-pro-playground)

Wenn Sie Ayakaleaf Pro produktiv einsetzen möchten, finden Sie ausführliche Installationsanleitungen auf der Seite [Dokumentation](https://ayakaleaf-pro.ayaka.space/). Wir empfehlen dringend, Ayakaleaf Pro mit dem [ayaka-notes/Toolkit](https://github.com/ayaka-notes/toolkit/) zu installieren.

## Aktualisierung

Wenn Sie von einer früheren Version von Ayakaleaf Pro aktualisieren, lesen Sie bitte auf der [Releases-Seite](https://github.com/ayaka-notes/ayakaleaf-pro/releases) die Änderungen jeder Version zwischen Ihrer aktuellen Version und der Zielversion nach.

## Übersetzungen

Beiträge zu den Übersetzungen von Ayakaleaf Pro sind willkommen. In der Regel verwenden wir claude/codex, um die englischen Texte in andere Sprachen zu übersetzen. Wenn Sie Fehler in den Übersetzungen finden, reichen Sie bitte einen Pull Request ein, um sie zu korrigieren. Bitte ändern Sie nur die betreffenden Dateien im Ordner `services/web/locales/locales_patches`.

Die Dateien unter `services/web/locales/` sind die offiziellen Übersetzungsdateien von Overleaf. Bitte ändern Sie sie nicht direkt.

## Mitwirken

Informationen zur Mitwirkung an der Entwicklung von Overleaf finden Sie in der Datei [CONTRIBUTING](../CONTRIBUTING.md).

## Blog
Wir schreiben über die Interna von Overleaf, die Kompilierleistung und selbst gehostete LaTeX-Infrastruktur. Mehr dazu in unserem Blog:
- [2026.08 Overleaf Server Pro Price and Open-Source Alternative](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-server-pro-price-and-open-source-alternative)
- [2026.08 Overleaf Benchmark: A Deep Research of Concurrent LaTeX Compilation in Overleaf](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-benchmark)

## Autoren

- [Das Overleaf-Team](https://www.overleaf.com/about)
- [Funktionen und Urheberrecht](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright)

## Lizenz

Der Code in diesem Repository wird unter der GNU AFFERO GENERAL PUBLIC LICENSE, version 3 veröffentlicht. Eine Kopie befindet sich in der Datei [`LICENSE`](../LICENSE).

- Copyright (c) Overleaf, 2014-2025.
- Copyright (c) [Pro Authors](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright), 2026-now.

## Sponsoren
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
