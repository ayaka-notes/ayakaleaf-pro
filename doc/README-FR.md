<h1 align="center">
  <br>
  <a href="https://ayakaleaf-pro.ayaka.space"><img src="logo.png" alt="Ayakaleaf Pro" width="300"></a>
</h1>

<h4 align="center">Overleaf Community Edition enrichi de toutes les fonctionnalités Pro <br/>(open source, gratuit, auto-hébergeable).</h4>

<p align="center">
  <a href="https://ayakaleaf-pro.ayaka.space">Documentation</a> •
  <a href="https://github.com/ayaka-notes/ayakaleaf-pro-playground">Playground</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/blog">Blog</a> •
  <a href="https://github.com/orgs/ayaka-notes/packages/container/package/overleaf-pro">Image Docker</a> •
  <a href="https://github.com/ayaka-notes/texlive-full">TeXLive</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/dev">Développeurs</a> •
  <a href="#auteurs">Auteurs</a> •
  <a href="#licence">Licence</a>
</p>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README-CS.md">Čeština</a> ·
  <a href="README-DA.md">Dansk</a> ·
  <a href="README-DE.md">Deutsch</a> ·
  <a href="README-ES.md">Español</a> ·
  <a href="README-FI.md">Suomi</a> ·
  <b>Français</b> ·
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

<img src="screenshot-pro.png" alt="Capture d'écran d'un projet en cours d'édition dans Overleaf Community Edition">
<p align="center">
  Figure 1 : capture d'écran d'un projet en cours d'édition dans Ayakaleaf Pro Edition.
</p>

## Ayakaleaf Pro Edition
Ayakaleaf Pro est une version améliorée d'Overleaf qui offre presque toutes les fonctionnalités et capacités. Pour plus de détails, consultez la page [Ayakaleaf Pro](https://ayakaleaf-pro.ayaka.space). Les fonctionnalités d'Ayakaleaf Pro comprennent :

- Synchronisation bidirectionnelle avec Dropbox (gardez tous vos projets synchronisés avec Dropbox)
- Serveur MCP (laissez des agents IA modifier, compiler et commenter)
- Assistant de chat IA (discutez, modifiez et corrigez avec l'IA)
- Assistant d'erreurs (explique et corrige les erreurs de compilation)
- Import/export Pandoc (convertissez Word, Markdown et LaTeX)
- Exécution de scripts Python (exécutez du Python dans votre projet)
- Synchronisation bidirectionnelle avec GitHub (Enterprise) (push et pull avec GitHub)
- Synchronisation bidirectionnelle avec GitLab (GitLab.com ou GitLab auto-hébergé)
- Synchronisation bidirectionnelle avec Gitea (Gitea.com ou Gitea auto-hébergé)
- Intégration Zotero (avec prise en charge d'OAuth pour Zotero)
- Intégration Mendeley (avec prise en charge d'OAuth pour Mendeley)
- Recherche avancée de références (recherchez dans toutes vos entrées bib)
- Prise en charge de Git-Bridge (clone, pull et push avec Git)
- Panneau d'administration (gestion globale des utilisateurs/projets)
- SSO avec LDAP et SAML ou OAuth 2.0
- Temps de compilation illimité (réglable dans le panneau d'administration)
- Inscription libre (facultative, peut être limitée par domaine de messagerie)
- Compilation en sandbox (avec prise en charge de l'image [texlive-full](https://github.com/ayaka-notes/texlive-full))
- Système de modèles (avec galerie de modèles)
- Suivi des modifications (avec panneau de relecture et de commentaires)
- Historique complet du projet (avec restauration et téléchargement)
- Palette de symboles (insérez des symboles mathématiques en un clic)
- Traduction i18n complète (chaque texte de l'interface en 18 langues)
- Prise en charge d'ARM (x86_64/arm64 sous Docker)

Enfin et surtout, Ayakaleaf Pro est open source, libre d'utilisation et de modification. Vous pouvez l'auto-héberger et contribuer au développement d'Ayakaleaf Pro. Pour plus de détails, consultez la page [Documentation pour les développeurs](https://ayakaleaf-pro.ayaka.space/dev).

> [!NOTE]
> Remarque : Ayakaleaf Pro n'est pas affilié à Overleaf, Inc. ni à sa société mère, Digital Science. Ce n'est pas non plus l'édition *Server Pro*, qui est un produit commercial proposé par Overleaf, Inc.
> 
> Ayakaleaf Pro est un projet indépendant développé et maintenu par [ayaka-notes](https://github.com/ayaka-notes).

## Installation

Si vous souhaitez simplement essayer Ayakaleaf Pro sans configurer de serveur, vous pouvez utiliser notre [Ayakaleaf Pro Playground](https://github.com/ayaka-notes/ayakaleaf-pro-playground). Il fournit un environnement GitHub Codespaces préconfiguré qui vous permet de lancer et d'explorer Ayakaleaf Pro directement dans votre navigateur.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ayaka-notes/ayakaleaf-pro-playground)

Si vous souhaitez déployer Ayakaleaf Pro en production, des instructions d'installation détaillées sont disponibles sur la page [Documentation](https://ayakaleaf-pro.ayaka.space/). Nous recommandons vivement d'installer Ayakaleaf Pro à l'aide du [ayaka-notes/Toolkit](https://github.com/ayaka-notes/toolkit/).

## Mise à jour

Si vous effectuez une mise à jour depuis une version précédente d'Ayakaleaf Pro, consultez la [page des versions](https://github.com/ayaka-notes/ayakaleaf-pro/releases) pour connaître les changements de chaque version entre votre version actuelle et celle vers laquelle vous effectuez la mise à jour.

## Traductions

Les contributions aux traductions d'Ayakaleaf Pro sont les bienvenues. En général, nous utilisons claude/codex pour traduire le texte anglais dans les autres langues. Si vous trouvez des erreurs dans les traductions, veuillez soumettre une pull request pour les corriger. Veuillez modifier uniquement les fichiers concernés dans le dossier `services/web/locales/locales_patches`.

Les fichiers sous `services/web/locales/` sont les fichiers de traduction officiels d'Overleaf. Veuillez ne pas les modifier directement.

## Contribuer

Veuillez consulter le fichier [CONTRIBUTING](../CONTRIBUTING.md) pour savoir comment contribuer au développement d'Overleaf.

## Blog
Nous écrivons sur le fonctionnement interne d'Overleaf, les performances de compilation et l'infrastructure LaTeX auto-hébergée. Pour en savoir plus, consultez notre blog :
- [2026.08 Overleaf Server Pro Price and Open-Source Alternative](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-server-pro-price-and-open-source-alternative)
- [2026.08 Overleaf Benchmark: A Deep Research of Concurrent LaTeX Compilation in Overleaf](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-benchmark)

## Auteurs

- [L'équipe Overleaf](https://www.overleaf.com/about)
- [Fonctionnalités et droits d'auteur](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright)

## Licence

Le code de ce dépôt est publié sous la GNU AFFERO GENERAL PUBLIC LICENSE, version 3. Une copie se trouve dans le fichier [`LICENSE`](../LICENSE).

- Copyright (c) Overleaf, 2014-2025.
- Copyright (c) [Pro Authors](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright), 2026-now.

## Sponsors
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
