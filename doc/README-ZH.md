<h1 align="center">
  <br>
  <a href="https://ayakaleaf-pro.ayaka.space"><img src="logo.png" alt="Ayakaleaf Pro" width="300"></a>
</h1>

<h4 align="center">集成全部 Pro 功能的 Overleaf Community Edition 增强版 <br/>（开源、免费使用、可自托管）。</h4>

<p align="center">
  <a href="https://ayakaleaf-pro.ayaka.space">文档</a> •
  <a href="https://github.com/ayaka-notes/ayakaleaf-pro-playground">Playground</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/blog">博客</a> •
  <a href="https://github.com/orgs/ayaka-notes/packages/container/package/overleaf-pro">Docker 镜像</a> •
  <a href="https://github.com/ayaka-notes/texlive-full">TeXLive</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/dev">开发者</a> •
  <a href="#作者">作者</a> •
  <a href="#许可证">许可证</a>
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
  <a href="README-SV.md">Svenska</a> ·
  <a href="README-TR.md">Türkçe</a> ·
  <b>简体中文</b>
</p>

<img src="screenshot-pro.png" alt="在 Overleaf Community Edition 中编辑项目的截图">
<p align="center">
  图 1：在 Ayakaleaf Pro Edition 中编辑项目的截图。
</p>

## Ayakaleaf Pro 版
Ayakaleaf Pro 是 Overleaf 的增强版本，具备几乎全部功能与能力。详情请参阅 [Ayakaleaf Pro](https://ayakaleaf-pro.ayaka.space) 页面。Ayakaleaf Pro 的功能包括：

- Dropbox 双向同步（让你的所有项目与 Dropbox 保持同步）
- MCP 服务器（让 AI 智能体编辑、编译和评论）
- AI 聊天助手（借助 AI 聊天、编辑和修复）
- 错误助手（解释并修复编译错误）
- Pandoc 导入/导出（转换 Word、Markdown 和 LaTeX）
- Python 脚本运行器（在你的项目中运行 Python）
- GitHub（Enterprise）双向同步（与 GitHub 推送和拉取）
- GitLab 双向同步（GitLab.com 或自托管 GitLab）
- Gitea 双向同步（Gitea.com 或自托管 Gitea）
- Zotero 集成（支持 Zotero OAuth）
- Mendeley 集成（支持 Mendeley OAuth）
- 高级参考文献搜索（搜索你的全部 Bib 条目）
- Git-Bridge 支持（使用 Git 克隆、拉取和推送）
- 管理面板（全局用户/项目管理）
- 通过 LDAP、SAML 或 OAuth 2.0 实现 SSO
- 不限编译时长（可在管理面板中调整）
- 自助注册（可选，可按邮箱域名限制）
- 沙箱编译（支持 [texlive-full](https://github.com/ayaka-notes/texlive-full) 镜像）
- 模板系统（附带模板库）
- 修订追踪（附带审阅与评论面板）
- 完整项目历史（支持恢复和下载）
- 符号面板（一键插入数学符号）
- 完整 i18n 翻译（全部界面文字支持 18 种语言）
- ARM 支持（Docker 上的 x86_64/arm64）

最后同样重要的是，Ayakaleaf Pro 是开源的，可免费使用和修改。你可以自托管它，并为 Ayakaleaf Pro 的开发做出贡献。更多详情请参阅 [开发者文档](https://ayakaleaf-pro.ayaka.space/dev) 页面。

> [!NOTE]
> 注意：Ayakaleaf Pro 与 Overleaf, Inc. 及其母公司 Digital Science 没有任何关联。它也*不是 Server Pro* 版，后者是 Overleaf, Inc. 提供的商业产品。
> 
> Ayakaleaf Pro 是由 [ayaka-notes](https://github.com/ayaka-notes) 开发和维护的独立项目。

## 安装

如果你只想试用 Ayakaleaf Pro 而不搭建服务器，可以使用我们的 [Ayakaleaf Pro Playground](https://github.com/ayaka-notes/ayakaleaf-pro-playground)。它提供一个预先配置好的 GitHub Codespaces 环境，让你直接在浏览器中启动并体验 Ayakaleaf Pro。

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ayaka-notes/ayakaleaf-pro-playground)

如果你想将 Ayakaleaf Pro 部署到生产环境，可在 [文档](https://ayakaleaf-pro.ayaka.space/) 页面查看详细的安装说明。我们强烈建议使用 [ayaka-notes/Toolkit](https://github.com/ayaka-notes/toolkit/) 安装 Ayakaleaf Pro。

## 升级

如果你要从旧版本的 Ayakaleaf Pro 升级，请查看 [Releases 页面](https://github.com/ayaka-notes/ayakaleaf-pro/releases)，了解从当前版本到目标版本之间每个版本的变更。

## 翻译

我们欢迎为 Ayakaleaf Pro 的翻译做出贡献。通常，我们使用 claude/codex 将英文文本翻译成其他语言。如果你发现翻译中有任何错误，请提交 pull request 进行修正。请仅修改 `services/web/locales/locales_patches` 文件夹中的相关文件。

`services/web/locales/` 下的文件是 Overleaf 官方翻译文件，请不要直接修改它们。

## 贡献

关于参与 Overleaf 开发的信息，请参阅 [CONTRIBUTING](../CONTRIBUTING.md) 文件。

## 博客
我们撰写有关 Overleaf 内部机制、编译性能和自托管 LaTeX 基础设施的文章。在我们的博客上阅读更多：
- [2026.08 Overleaf Server Pro Price and Open-Source Alternative](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-server-pro-price-and-open-source-alternative)
- [2026.08 Overleaf Benchmark: A Deep Research of Concurrent LaTeX Compilation in Overleaf](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-benchmark)

## 作者

- [Overleaf 团队](https://www.overleaf.com/about)
- [功能与版权](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright)

## 许可证

本仓库中的代码以 GNU AFFERO GENERAL PUBLIC LICENSE, version 3 发布。许可证副本见 [`LICENSE`](../LICENSE) 文件。

- Copyright (c) Overleaf, 2014-2025.
- Copyright (c) [Pro Authors](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright), 2026-now.

## 赞助
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
