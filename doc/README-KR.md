<h1 align="center">
  <br>
  <a href="https://ayakaleaf-pro.ayaka.space"><img src="logo.png" alt="Ayakaleaf Pro" width="300"></a>
</h1>

<h4 align="center">모든 Pro 기능을 갖춘 Overleaf Community Edition 확장판 <br/>(오픈 소스, 무료 사용, 자체 호스팅 가능).</h4>

<p align="center">
  <a href="https://ayakaleaf-pro.ayaka.space">문서</a> •
  <a href="https://github.com/ayaka-notes/ayakaleaf-pro-playground">Playground</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/blog">블로그</a> •
  <a href="https://github.com/orgs/ayaka-notes/packages/container/package/overleaf-pro">Docker 이미지</a> •
  <a href="https://github.com/ayaka-notes/texlive-full">TeXLive</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/dev">개발자</a> •
  <a href="#저자">저자</a> •
  <a href="#라이선스">라이선스</a>
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
  <b>한국어</b> ·
  <a href="README-NL.md">Nederlands</a> ·
  <a href="README-NO.md">Norsk</a> ·
  <a href="README-PL.md">Polski</a> ·
  <a href="README-PT.md">Português</a> ·
  <a href="README-RU.md">Русский</a> ·
  <a href="README-SV.md">Svenska</a> ·
  <a href="README-TR.md">Türkçe</a> ·
  <a href="README-ZH.md">简体中文</a>
</p>

<img src="screenshot-pro.png" alt="Overleaf Community Edition에서 프로젝트를 편집하는 화면의 스크린샷">
<p align="center">
  그림 1: Ayakaleaf Pro Edition에서 프로젝트를 편집하는 화면의 스크린샷.
</p>

## Ayakaleaf Pro Edition
Ayakaleaf Pro는 거의 모든 기능을 갖춘 Overleaf의 확장판입니다. 자세한 내용은 [Ayakaleaf Pro](https://ayakaleaf-pro.ayaka.space) 페이지를 확인하세요. Ayakaleaf Pro의 기능은 다음과 같습니다:

- Dropbox 양방향 동기화 (모든 프로젝트를 Dropbox와 동기화)
- MCP 서버 (AI 에이전트가 편집, 컴파일, 댓글 작성)
- AI 채팅 어시스턴트 (AI와 채팅, 편집, 수정)
- 오류 어시스턴트 (컴파일 오류 설명 및 수정)
- Pandoc 가져오기/내보내기 (Word, Markdown, LaTeX 변환)
- Python 스크립트 실행기 (프로젝트에서 Python 실행)
- GitHub(Enterprise) 양방향 동기화 (GitHub와 푸시 및 풀)
- GitLab 양방향 동기화 (GitLab.com 또는 자체 호스팅 GitLab)
- Gitea 양방향 동기화 (Gitea.com 또는 자체 호스팅 Gitea)
- Zotero 연동 (Zotero OAuth 지원)
- Mendeley 연동 (Mendeley OAuth 지원)
- 고급 참고문헌 검색 (모든 Bib 항목 검색)
- Git-Bridge 지원 (Git으로 클론, 풀, 푸시)
- 관리자 패널 (전체 사용자/프로젝트 관리)
- LDAP, SAML 또는 OAuth 2.0을 통한 SSO
- 무제한 컴파일 시간 (관리자 패널에서 조정 가능)
- 자체 가입 (선택 사항, 메일 도메인으로 제한 가능)
- 샌드박스 컴파일 ([texlive-full](https://github.com/ayaka-notes/texlive-full) 이미지 지원)
- 템플릿 시스템 (템플릿 갤러리 포함)
- 변경 내용 추적 (검토 및 댓글 패널 포함)
- 전체 프로젝트 기록 (복원 및 다운로드 지원)
- 기호 팔레트 (클릭 한 번으로 수학 기호 삽입)
- 완전한 i18n 번역 (모든 UI 문자열을 18개 언어로 제공)
- ARM 지원 (Docker에서 x86_64/arm64)

마지막으로 중요한 점은, Ayakaleaf Pro는 오픈 소스이며 무료로 사용하고 수정할 수 있다는 것입니다. 직접 호스팅할 수 있고 Ayakaleaf Pro 개발에 기여할 수도 있습니다. 자세한 내용은 [개발자 문서](https://ayakaleaf-pro.ayaka.space/dev) 페이지를 확인하세요.

> [!NOTE]
> 참고: Ayakaleaf Pro는 Overleaf, Inc. 또는 그 모회사인 Digital Science와 아무런 관련이 없습니다. 또한 Overleaf, Inc.가 제공하는 상용 제품인 *Server Pro* Edition도 *아닙니다*.
> 
> Ayakaleaf Pro는 [ayaka-notes](https://github.com/ayaka-notes)가 개발하고 유지 관리하는 독립 프로젝트입니다.

## 설치

서버를 구축하지 않고 Ayakaleaf Pro를 체험만 해 보고 싶다면 [Ayakaleaf Pro Playground](https://github.com/ayaka-notes/ayakaleaf-pro-playground)를 사용할 수 있습니다. 미리 구성된 GitHub Codespaces 환경을 제공하므로 브라우저에서 바로 Ayakaleaf Pro를 실행하고 살펴볼 수 있습니다.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ayaka-notes/ayakaleaf-pro-playground)

Ayakaleaf Pro를 프로덕션 환경에 배포하려면 [문서](https://ayakaleaf-pro.ayaka.space/) 페이지의 자세한 설치 안내를 참고하세요. Ayakaleaf Pro는 [ayaka-notes/Toolkit](https://github.com/ayaka-notes/toolkit/)으로 설치할 것을 강력히 권장합니다.

## 업그레이드

이전 버전의 Ayakaleaf Pro에서 업그레이드하는 경우, [Releases 페이지](https://github.com/ayaka-notes/ayakaleaf-pro/releases)에서 현재 버전부터 업그레이드할 버전까지 각 버전의 변경 사항을 확인하세요.

## 번역

Ayakaleaf Pro 번역에 대한 기여를 환영합니다. 일반적으로 영어 텍스트는 claude/codex를 사용해 다른 언어로 번역합니다. 번역에서 오류를 발견하면 수정하는 pull request를 제출해 주세요. `services/web/locales/locales_patches` 폴더의 관련 파일만 수정해 주세요.

`services/web/locales/` 아래의 파일은 Overleaf 공식 번역 파일입니다. 직접 수정하지 마세요.

## 기여

Overleaf 개발에 기여하는 방법은 [CONTRIBUTING](../CONTRIBUTING.md) 파일을 참고하세요.

## 블로그
Overleaf 내부 구조, 컴파일 성능, 자체 호스팅 LaTeX 인프라에 관한 글을 씁니다. 블로그에서 더 읽어 보세요:
- [2026.08 Overleaf Server Pro Price and Open-Source Alternative](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-server-pro-price-and-open-source-alternative)
- [2026.08 Overleaf Benchmark: A Deep Research of Concurrent LaTeX Compilation in Overleaf](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-benchmark)

## 저자

- [Overleaf 팀](https://www.overleaf.com/about)
- [기능 및 저작권](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright)

## 라이선스

이 저장소의 코드는 GNU AFFERO GENERAL PUBLIC LICENSE, version 3에 따라 배포됩니다. 사본은 [`LICENSE`](../LICENSE) 파일에서 확인할 수 있습니다.

- Copyright (c) Overleaf, 2014-2025.
- Copyright (c) [Pro Authors](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright), 2026-now.

## 후원
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
