<h1 align="center">
  <br>
  <a href="https://ayakaleaf-pro.ayaka.space"><img src="logo.png" alt="Ayakaleaf Pro" width="300"></a>
</h1>

<h4 align="center">Overleaf Community Edition rozszerzony o wszystkie funkcje Pro <br/>(open source, bezpłatny, do samodzielnego hostowania).</h4>

<p align="center">
  <a href="https://ayakaleaf-pro.ayaka.space">Dokumentacja</a> •
  <a href="https://github.com/ayaka-notes/ayakaleaf-pro-playground">Playground</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/blog">Blog</a> •
  <a href="https://github.com/orgs/ayaka-notes/packages/container/package/overleaf-pro">Obraz Docker</a> •
  <a href="https://github.com/ayaka-notes/texlive-full">TeXLive</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/dev">Dla programistów</a> •
  <a href="#autorzy">Autorzy</a> •
  <a href="#licencja">Licencja</a>
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
  <b>Polski</b> ·
  <a href="README-PT.md">Português</a> ·
  <a href="README-RU.md">Русский</a> ·
  <a href="README-SV.md">Svenska</a> ·
  <a href="README-TR.md">Türkçe</a> ·
  <a href="README-ZH.md">简体中文</a>
</p>

<img src="screenshot-pro.png" alt="Zrzut ekranu projektu edytowanego w Overleaf Community Edition">
<p align="center">
  Rysunek 1: Zrzut ekranu projektu edytowanego w Ayakaleaf Pro Edition.
</p>

## Ayakaleaf Pro Edition
Ayakaleaf Pro to rozszerzona wersja Overleaf z niemal wszystkimi funkcjami i możliwościami. Szczegóły znajdziesz na stronie [Ayakaleaf Pro](https://ayakaleaf-pro.ayaka.space). Funkcje Ayakaleaf Pro obejmują:

- Dwukierunkowa synchronizacja z Dropbox (wszystkie Twoje projekty zsynchronizowane z Dropbox)
- Serwer MCP (agenci AI mogą edytować, kompilować i komentować)
- Asystent czatu AI (rozmawiaj, edytuj i poprawiaj z pomocą AI)
- Asystent błędów (wyjaśnia i naprawia błędy kompilacji)
- Import/eksport Pandoc (konwersja Word, Markdown i LaTeX)
- Uruchamianie skryptów Python (uruchamiaj Python w swoim projekcie)
- Dwukierunkowa synchronizacja z GitHub (Enterprise) (push i pull z GitHub)
- Dwukierunkowa synchronizacja z GitLab (GitLab.com lub samodzielnie hostowany GitLab)
- Dwukierunkowa synchronizacja z Gitea (Gitea.com lub samodzielnie hostowany Gitea)
- Integracja z Zotero (z obsługą Zotero OAuth)
- Integracja z Mendeley (z obsługą Mendeley OAuth)
- Zaawansowane wyszukiwanie bibliografii (przeszukuj wszystkie swoje wpisy Bib)
- Obsługa Git-Bridge (clone, pull i push przez Git)
- Panel administracyjny (globalne zarządzanie użytkownikami i projektami)
- SSO przez LDAP i SAML lub OAuth 2.0
- Nieograniczony czas kompilacji (konfigurowalny w panelu administracyjnym)
- Samodzielna rejestracja (opcjonalna, może być ograniczona do domeny e-mail)
- Kompilacja w piaskownicy (z obsługą obrazu [texlive-full](https://github.com/ayaka-notes/texlive-full))
- System szablonów (z galerią szablonów)
- Śledzenie zmian (z panelem recenzji i komentarzy)
- Pełna historia projektu (z przywracaniem i pobieraniem)
- Paleta symboli (wstawianie symboli matematycznych jednym kliknięciem)
- Pełne tłumaczenie i18n (każdy tekst interfejsu w 18 językach)
- Obsługa ARM (x86_64/arm64 w Docker)

Na koniec, co nie mniej ważne: Ayakaleaf Pro jest projektem open source, który można bezpłatnie używać i modyfikować. Możesz hostować go samodzielnie i współtworzyć Ayakaleaf Pro. Więcej szczegółów znajdziesz na stronie [dokumentacji dla programistów](https://ayakaleaf-pro.ayaka.space/dev).

> [!NOTE]
> Uwaga: Ayakaleaf Pro nie jest powiązany z Overleaf, Inc. ani z jej spółką macierzystą Digital Science. Nie jest to również edycja *Server Pro*, która jest komercyjnym produktem oferowanym przez Overleaf, Inc.
> 
> Ayakaleaf Pro to niezależny projekt rozwijany i utrzymywany przez [ayaka-notes](https://github.com/ayaka-notes).

## Instalacja

Jeśli chcesz tylko wypróbować Ayakaleaf Pro bez konfigurowania serwera, możesz skorzystać z naszego [Ayakaleaf Pro Playground](https://github.com/ayaka-notes/ayakaleaf-pro-playground). Udostępnia on wstępnie skonfigurowane środowisko GitHub Codespaces, w którym możesz uruchomić i poznać Ayakaleaf Pro bezpośrednio w przeglądarce.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ayaka-notes/ayakaleaf-pro-playground)

Jeśli chcesz wdrożyć Ayakaleaf Pro do użytku produkcyjnego, szczegółowe instrukcje instalacji znajdziesz na stronie [dokumentacji](https://ayakaleaf-pro.ayaka.space/). Zdecydowanie zalecamy instalację Ayakaleaf Pro za pomocą [ayaka-notes/Toolkit](https://github.com/ayaka-notes/toolkit/).

## Aktualizacja

Jeśli aktualizujesz Ayakaleaf Pro z poprzedniej wersji, zapoznaj się na [stronie wydań](https://github.com/ayaka-notes/ayakaleaf-pro/releases) ze zmianami w każdej wersji pomiędzy Twoją obecną wersją a tą, do której przechodzisz.

## Tłumaczenia

Zachęcamy do współtworzenia tłumaczeń Ayakaleaf Pro. Zazwyczaj używamy claude/codex do tłumaczenia tekstu angielskiego na inne języki. Jeśli znajdziesz błędy w tłumaczeniach, prześlij pull request z poprawkami. Prosimy modyfikować wyłącznie odpowiednie pliki w folderze `services/web/locales/locales_patches`.

Pliki w `services/web/locales/` to oficjalne pliki tłumaczeń Overleaf. Prosimy nie modyfikować ich bezpośrednio.

## Współtworzenie

Informacje o współtworzeniu Overleaf znajdziesz w pliku [CONTRIBUTING](../CONTRIBUTING.md).

## Blog
Piszemy o wewnętrznym działaniu Overleaf, wydajności kompilacji i samodzielnie hostowanej infrastrukturze LaTeX. Więcej przeczytasz na naszym blogu:
- [2026.08 Overleaf Server Pro Price and Open-Source Alternative](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-server-pro-price-and-open-source-alternative)
- [2026.08 Overleaf Benchmark: A Deep Research of Concurrent LaTeX Compilation in Overleaf](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-benchmark)

## Autorzy

- [Zespół Overleaf](https://www.overleaf.com/about)
- [Funkcje i prawa autorskie](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright)

## Licencja

Kod w tym repozytorium jest udostępniany na licencji GNU AFFERO GENERAL PUBLIC LICENSE, version 3. Jej kopię można znaleźć w pliku [`LICENSE`](../LICENSE).

- Copyright (c) Overleaf, 2014-2025.
- Copyright (c) [Pro Authors](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright), 2026-now.

## Sponsorzy
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
