<h1 align="center">
  <br>
  <a href="https://ayakaleaf-pro.ayaka.space"><img src="logo.png" alt="Ayakaleaf Pro" width="300"></a>
</h1>

<h4 align="center">Overleaf Community Edition mejorado con todas las funciones Pro <br/>(código abierto, de uso gratuito y autoalojable).</h4>

<p align="center">
  <a href="https://ayakaleaf-pro.ayaka.space">Documentación</a> •
  <a href="https://github.com/ayaka-notes/ayakaleaf-pro-playground">Playground</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/blog">Blog</a> •
  <a href="https://github.com/orgs/ayaka-notes/packages/container/package/overleaf-pro">Imagen de Docker</a> •
  <a href="https://github.com/ayaka-notes/texlive-full">TeXLive</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/dev">Desarrolladores</a> •
  <a href="#autores">Autores</a> •
  <a href="#licencia">Licencia</a>
</p>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README-CS.md">Čeština</a> ·
  <a href="README-DA.md">Dansk</a> ·
  <a href="README-DE.md">Deutsch</a> ·
  <b>Español</b> ·
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

<img src="screenshot-pro.png" alt="Captura de pantalla de un proyecto en edición en Overleaf Community Edition">
<p align="center">
  Figura 1: Captura de pantalla de un proyecto en edición en Ayakaleaf Pro Edition.
</p>

## Ayakaleaf Pro Edition
Ayakaleaf Pro es una versión mejorada de Overleaf con casi todas las funciones y capacidades. Para más detalles, consulta la página de [Ayakaleaf Pro](https://ayakaleaf-pro.ayaka.space). Entre las funciones de Ayakaleaf Pro se incluyen:

- Sincronización bidireccional con Dropbox (mantén todos tus proyectos sincronizados con Dropbox)
- Servidor MCP (deja que los agentes de IA editen, compilen y comenten)
- Asistente de chat con IA (chatea, edita y corrige con IA)
- Asistente de errores (explica y corrige errores de compilación)
- Importación/exportación con Pandoc (convierte Word, Markdown y LaTeX)
- Ejecutor de scripts de Python (ejecuta Python en tu proyecto)
- Sincronización bidireccional con GitHub (Enterprise) (push y pull con GitHub)
- Sincronización bidireccional con GitLab (GitLab.com o GitLab autoalojado)
- Sincronización bidireccional con Gitea (Gitea.com o Gitea autoalojado)
- Integración con Zotero (con soporte para OAuth de Zotero)
- Integración con Mendeley (con soporte para OAuth de Mendeley)
- Búsqueda avanzada de referencias (busca en todas tus entradas bib)
- Soporte para Git-Bridge (clone, pull y push con Git)
- Panel de administración (gestión global de usuarios/proyectos)
- SSO con LDAP y SAML u OAuth 2.0
- Tiempo de compilación ilimitado (ajustable en el panel de administración)
- Autorregistro (opcional, se puede limitar por dominio de correo)
- Compilación en sandbox (con soporte para la imagen [texlive-full](https://github.com/ayaka-notes/texlive-full))
- Sistema de plantillas (con galería de plantillas)
- Control de cambios (con panel de revisión y comentarios)
- Historial completo del proyecto (con restauración y descarga)
- Paleta de símbolos (inserta símbolos matemáticos con un clic)
- Traducción i18n completa (cada texto de la interfaz en 18 idiomas)
- Soporte para ARM (x86_64/arm64 en Docker)

Por último, pero no menos importante, Ayakaleaf Pro es de código abierto y se puede usar y modificar de forma gratuita. Puedes alojarlo tú mismo y contribuir al desarrollo de Ayakaleaf Pro. Para más detalles, consulta la página de [Documentación para desarrolladores](https://ayakaleaf-pro.ayaka.space/dev).

> [!NOTE]
> Nota: Ayakaleaf Pro no está afiliado a Overleaf, Inc. ni a su empresa matriz, Digital Science. Tampoco es la edición *Server Pro*, que es un producto comercial ofrecido por Overleaf, Inc.
> 
> Ayakaleaf Pro es un proyecto independiente desarrollado y mantenido por [ayaka-notes](https://github.com/ayaka-notes).

## Instalación

Si solo quieres probar Ayakaleaf Pro sin configurar un servidor, puedes usar nuestro [Ayakaleaf Pro Playground](https://github.com/ayaka-notes/ayakaleaf-pro-playground). Ofrece un entorno de GitHub Codespaces preconfigurado que te permite iniciar y explorar Ayakaleaf Pro directamente en tu navegador.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ayaka-notes/ayakaleaf-pro-playground)

Si quieres desplegar Ayakaleaf Pro en producción, tenemos instrucciones de instalación detalladas en la página de [Documentación](https://ayakaleaf-pro.ayaka.space/). Recomendamos encarecidamente instalar Ayakaleaf Pro con el [ayaka-notes/Toolkit](https://github.com/ayaka-notes/toolkit/).

## Actualización

Si vas a actualizar desde una versión anterior de Ayakaleaf Pro, consulta la [página de versiones](https://github.com/ayaka-notes/ayakaleaf-pro/releases) para ver los cambios de cada versión entre tu versión actual y la versión a la que vas a actualizar.

## Traducciones

Agradecemos las contribuciones a las traducciones de Ayakaleaf Pro. Por lo general, usamos claude/codex para traducir el texto en inglés a otros idiomas. Si encuentras algún error en las traducciones, envía un pull request para corregirlo. Modifica únicamente los archivos correspondientes de la carpeta `services/web/locales/locales_patches`.

Los archivos de `services/web/locales/` son los archivos de traducción oficiales de Overleaf. No los modifiques directamente.

## Contribuir

Consulta el archivo [CONTRIBUTING](../CONTRIBUTING.md) para obtener información sobre cómo contribuir al desarrollo de Overleaf.

## Blog
Escribimos sobre el funcionamiento interno de Overleaf, el rendimiento de la compilación y la infraestructura LaTeX autoalojada. Lee más en nuestro blog:
- [2026.08 Overleaf Server Pro Price and Open-Source Alternative](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-server-pro-price-and-open-source-alternative)
- [2026.08 Overleaf Benchmark: A Deep Research of Concurrent LaTeX Compilation in Overleaf](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-benchmark)

## Autores

- [El equipo de Overleaf](https://www.overleaf.com/about)
- [Funciones y derechos de autor](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright)

## Licencia

El código de este repositorio se publica bajo la GNU AFFERO GENERAL PUBLIC LICENSE, version 3. Puedes encontrar una copia en el archivo [`LICENSE`](../LICENSE).

- Copyright (c) Overleaf, 2014-2025.
- Copyright (c) [Pro Authors](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright), 2026-now.

## Patrocinadores
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
