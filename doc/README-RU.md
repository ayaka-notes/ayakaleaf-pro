<h1 align="center">
  <br>
  <a href="https://ayakaleaf-pro.ayaka.space"><img src="logo.png" alt="Ayakaleaf Pro" width="300"></a>
</h1>

<h4 align="center">Overleaf Community Edition, дополненный всеми функциями Pro <br/>(открытый исходный код, бесплатное использование, возможность самостоятельного размещения).</h4>

<p align="center">
  <a href="https://ayakaleaf-pro.ayaka.space">Документация</a> •
  <a href="https://github.com/ayaka-notes/ayakaleaf-pro-playground">Playground</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/blog">Блог</a> •
  <a href="https://github.com/orgs/ayaka-notes/packages/container/package/overleaf-pro">Docker-образ</a> •
  <a href="https://github.com/ayaka-notes/texlive-full">TeXLive</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/dev">Разработчикам</a> •
  <a href="#авторы">Авторы</a> •
  <a href="#лицензия">Лицензия</a>
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
  <b>Русский</b> ·
  <a href="README-SV.md">Svenska</a> ·
  <a href="README-TR.md">Türkçe</a> ·
  <a href="README-ZH.md">简体中文</a>
</p>

<img src="screenshot-pro.png" alt="Снимок экрана: редактирование проекта в Overleaf Community Edition">
<p align="center">
  Рисунок 1: Снимок экрана: редактирование проекта в Ayakaleaf Pro Edition.
</p>

## Ayakaleaf Pro Edition
Ayakaleaf Pro — это расширенная версия Overleaf, включающая почти все функции и возможности. Подробности см. на странице [Ayakaleaf Pro](https://ayakaleaf-pro.ayaka.space). Функции Ayakaleaf Pro:

- Двусторонняя синхронизация с Dropbox (все ваши проекты синхронизированы с Dropbox)
- MCP-сервер (ИИ-агенты могут редактировать, компилировать и комментировать)
- ИИ-ассистент в чате (общайтесь, редактируйте и исправляйте с помощью ИИ)
- Помощник по ошибкам (объясняет и исправляет ошибки компиляции)
- Импорт/экспорт через Pandoc (конвертация Word, Markdown и LaTeX)
- Запуск Python-скриптов (выполняйте Python в своём проекте)
- Двусторонняя синхронизация с GitHub (Enterprise) (push и pull с GitHub)
- Двусторонняя синхронизация с GitLab (GitLab.com или собственный экземпляр GitLab)
- Двусторонняя синхронизация с Gitea (Gitea.com или собственный экземпляр Gitea)
- Интеграция с Zotero (с поддержкой Zotero OAuth)
- Интеграция с Mendeley (с поддержкой Mendeley OAuth)
- Расширенный поиск по библиографии (поиск по всем вашим Bib-записям)
- Поддержка Git-Bridge (clone, pull и push через Git)
- Панель администратора (глобальное управление пользователями и проектами)
- SSO через LDAP и SAML или OAuth 2.0
- Неограниченное время компиляции (настраивается в панели администратора)
- Самостоятельная регистрация (необязательна, может быть ограничена почтовым доменом)
- Компиляция в песочнице (с поддержкой образа [texlive-full](https://github.com/ayaka-notes/texlive-full))
- Система шаблонов (с галереей шаблонов)
- Отслеживание изменений (с панелью рецензирования и комментариев)
- Полная история проекта (с восстановлением и скачиванием)
- Палитра символов (вставка математических символов в один клик)
- Полная локализация i18n (каждая строка интерфейса на 18 языках)
- Поддержка ARM (x86_64/arm64 в Docker)

И последнее по порядку, но не по значению: Ayakaleaf Pro — проект с открытым исходным кодом, который можно бесплатно использовать и изменять. Вы можете разместить его на собственном сервере и участвовать в разработке Ayakaleaf Pro. Подробности см. на странице [документации для разработчиков](https://ayakaleaf-pro.ayaka.space/dev).

> [!NOTE]
> Примечание: Ayakaleaf Pro не связан с Overleaf, Inc. или её материнской компанией Digital Science. Это также *не редакция Server Pro* — коммерческий продукт, предлагаемый Overleaf, Inc.
> 
> Ayakaleaf Pro — независимый проект, который разрабатывает и поддерживает [ayaka-notes](https://github.com/ayaka-notes).

## Установка

Если вы хотите просто попробовать Ayakaleaf Pro без настройки сервера, воспользуйтесь нашим [Ayakaleaf Pro Playground](https://github.com/ayaka-notes/ayakaleaf-pro-playground). Он предоставляет преднастроенное окружение GitHub Codespaces, в котором можно запустить и изучить Ayakaleaf Pro прямо в браузере.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ayaka-notes/ayakaleaf-pro-playground)

Если вы хотите развернуть Ayakaleaf Pro для промышленной эксплуатации, подробные инструкции по установке приведены на странице [документации](https://ayakaleaf-pro.ayaka.space/). Мы настоятельно рекомендуем устанавливать Ayakaleaf Pro с помощью [ayaka-notes/Toolkit](https://github.com/ayaka-notes/toolkit/).

## Обновление

Если вы обновляетесь с предыдущей версии Ayakaleaf Pro, ознакомьтесь на [странице релизов](https://github.com/ayaka-notes/ayakaleaf-pro/releases) с изменениями в каждой версии между вашей текущей версией и той, на которую вы переходите.

## Переводы

Мы приветствуем вклад в переводы Ayakaleaf Pro. Как правило, мы используем claude/codex для перевода английского текста на другие языки. Если вы обнаружили ошибки в переводах, отправьте pull request с исправлением. Изменяйте, пожалуйста, только соответствующие файлы в папке `services/web/locales/locales_patches`.

Файлы в `services/web/locales/` — это официальные файлы переводов Overleaf. Пожалуйста, не изменяйте их напрямую.

## Участие в разработке

Информацию об участии в разработке Overleaf см. в файле [CONTRIBUTING](../CONTRIBUTING.md).

## Блог
Мы пишем о внутреннем устройстве Overleaf, производительности компиляции и самостоятельно размещаемой инфраструктуре LaTeX. Читайте больше в нашем блоге:
- [2026.08 Overleaf Server Pro Price and Open-Source Alternative](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-server-pro-price-and-open-source-alternative)
- [2026.08 Overleaf Benchmark: A Deep Research of Concurrent LaTeX Compilation in Overleaf](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-benchmark)

## Авторы

- [Команда Overleaf](https://www.overleaf.com/about)
- [Функции и авторские права](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright)

## Лицензия

Код в этом репозитории распространяется под лицензией GNU AFFERO GENERAL PUBLIC LICENSE, version 3. Её копию можно найти в файле [`LICENSE`](../LICENSE).

- Copyright (c) Overleaf, 2014-2025.
- Copyright (c) [Pro Authors](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright), 2026-now.

## Спонсоры
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
