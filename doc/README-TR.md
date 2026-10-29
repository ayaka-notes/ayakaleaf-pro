<h1 align="center">
  <br>
  <a href="https://ayakaleaf-pro.ayaka.space"><img src="logo.png" alt="Ayakaleaf Pro" width="300"></a>
</h1>

<h4 align="center">Tüm Pro özellikleriyle geliştirilmiş Overleaf Community Edition <br/>(açık kaynak, ücretsiz kullanım, kendi sunucunuzda barındırılabilir).</h4>

<p align="center">
  <a href="https://ayakaleaf-pro.ayaka.space">Belgeler</a> •
  <a href="https://github.com/ayaka-notes/ayakaleaf-pro-playground">Playground</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/blog">Blog</a> •
  <a href="https://github.com/orgs/ayaka-notes/packages/container/package/overleaf-pro">Docker İmajı</a> •
  <a href="https://github.com/ayaka-notes/texlive-full">TeXLive</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/dev">Geliştirici</a> •
  <a href="#yazarlar">Yazarlar</a> •
  <a href="#lisans">Lisans</a>
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
  <b>Türkçe</b> ·
  <a href="README-ZH.md">简体中文</a>
</p>

<img src="screenshot-pro.png" alt="Overleaf Community Edition'da düzenlenen bir projenin ekran görüntüsü">
<p align="center">
  Şekil 1: Ayakaleaf Pro Edition'da düzenlenen bir projenin ekran görüntüsü.
</p>

## Ayakaleaf Pro Edition
Ayakaleaf Pro, neredeyse tüm özellik ve yeteneklere sahip, Overleaf'in geliştirilmiş bir sürümüdür. Ayrıntılar için lütfen [Ayakaleaf Pro](https://ayakaleaf-pro.ayaka.space) sayfasına bakın. Ayakaleaf Pro'nun özellikleri şunlardır:

- Çift yönlü Dropbox senkronizasyonu (tüm projelerinizi Dropbox ile senkronize tutun)
- MCP sunucusu (yapay zekâ ajanlarının düzenlemesine, derlemesine ve yorum yapmasına izin verin)
- Yapay zekâ sohbet asistanı (yapay zekâ ile sohbet edin, düzenleyin ve düzeltin)
- Hata asistanı (derleme hatalarını açıklar ve düzeltir)
- Pandoc ile içe/dışa aktarma (Word, Markdown ve LaTeX dönüştürme)
- Python betik çalıştırıcı (projenizde Python çalıştırın)
- Çift yönlü GitHub (Enterprise) senkronizasyonu (GitHub ile push ve pull)
- Çift yönlü GitLab senkronizasyonu (GitLab.com veya kendi sunucunuzda barındırılan GitLab)
- Çift yönlü Gitea senkronizasyonu (Gitea.com veya kendi sunucunuzda barındırılan Gitea)
- Zotero entegrasyonu (Zotero OAuth desteğiyle)
- Mendeley entegrasyonu (Mendeley OAuth desteğiyle)
- Gelişmiş kaynakça araması (tüm Bib kayıtlarınızda arama yapın)
- Git-Bridge desteği (Git ile clone, pull ve push)
- Yönetim paneli (genel kullanıcı/proje yönetimi)
- LDAP ve SAML veya OAuth 2.0 ile SSO
- Sınırsız derleme süresi (yönetim panelinden ayarlanabilir)
- Kendi kendine kayıt (isteğe bağlı, e-posta alan adına göre sınırlandırılabilir)
- Korumalı alanda (sandbox) derleme ([texlive-full](https://github.com/ayaka-notes/texlive-full) imajı desteğiyle)
- Şablon sistemi (şablon galerisiyle)
- Değişiklikleri izleme (inceleme ve yorum paneliyle)
- Tam proje geçmişi (geri yükleme ve indirme ile)
- Sembol paleti (matematik sembollerini tek tıkla ekleyin)
- Tam i18n çevirisi (arayüzdeki her metin 18 dilde)
- ARM desteği (Docker üzerinde x86_64/arm64)

Son olarak, Ayakaleaf Pro açık kaynaklıdır; ücretsiz olarak kullanılabilir ve değiştirilebilir. Kendi sunucunuzda barındırabilir ve Ayakaleaf Pro'nun geliştirilmesine katkıda bulunabilirsiniz. Daha fazla ayrıntı için lütfen [Geliştirici Belgeleri](https://ayakaleaf-pro.ayaka.space/dev) sayfasına bakın.

> [!NOTE]
> Not: Ayakaleaf Pro'nun Overleaf, Inc. veya ana şirketi Digital Science ile herhangi bir bağlantısı yoktur. Ayrıca Overleaf, Inc. tarafından sunulan ticari bir ürün olan *Server Pro* Edition *değildir*.
> 
> Ayakaleaf Pro, [ayaka-notes](https://github.com/ayaka-notes) tarafından geliştirilen ve sürdürülen bağımsız bir projedir.

## Kurulum

Ayakaleaf Pro'yu bir sunucu kurmadan yalnızca denemek istiyorsanız [Ayakaleaf Pro Playground](https://github.com/ayaka-notes/ayakaleaf-pro-playground)'u kullanabilirsiniz. Ayakaleaf Pro'yu doğrudan tarayıcınızda başlatıp keşfetmenizi sağlayan, önceden yapılandırılmış bir GitHub Codespaces ortamı sunar.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ayaka-notes/ayakaleaf-pro-playground)

Ayakaleaf Pro'yu üretim ortamında kullanmak üzere dağıtmak istiyorsanız, ayrıntılı kurulum talimatları [Belgeler](https://ayakaleaf-pro.ayaka.space/) sayfasında yer almaktadır. Ayakaleaf Pro'yu [ayaka-notes/Toolkit](https://github.com/ayaka-notes/toolkit/) ile kurmanızı önemle tavsiye ederiz.

## Yükseltme

Ayakaleaf Pro'nun önceki bir sürümünden yükseltiyorsanız, mevcut sürümünüz ile yükselteceğiniz sürüm arasındaki her sürümün değişiklikleri için lütfen [Sürümler sayfasına](https://github.com/ayaka-notes/ayakaleaf-pro/releases) bakın.

## Çeviriler

Ayakaleaf Pro çevirilerine yapılan katkıları memnuniyetle karşılıyoruz. Genellikle İngilizce metni diğer dillere çevirmek için claude/codex kullanıyoruz. Çevirilerde bir hata bulursanız, düzeltmek için lütfen bir pull request gönderin. Lütfen yalnızca `services/web/locales/locales_patches` klasöründeki ilgili dosyaları değiştirin.

`services/web/locales/` altındaki dosyalar Overleaf'in resmî çeviri dosyalarıdır. Lütfen bunları doğrudan değiştirmeyin.

## Katkıda Bulunma

Overleaf'in geliştirilmesine katkıda bulunma hakkında bilgi için lütfen [CONTRIBUTING](../CONTRIBUTING.md) dosyasına bakın.

## Blog
Overleaf'in iç yapısı, derleme performansı ve kendi sunucunuzda barındırılan LaTeX altyapısı hakkında yazıyoruz. Daha fazlasını blogumuzda okuyun:
- [2026.08 Overleaf Server Pro Price and Open-Source Alternative](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-server-pro-price-and-open-source-alternative)
- [2026.08 Overleaf Benchmark: A Deep Research of Concurrent LaTeX Compilation in Overleaf](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-benchmark)

## Yazarlar

- [Overleaf Ekibi](https://www.overleaf.com/about)
- [Özellikler ve Telif Hakkı](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright)

## Lisans

Bu depodaki kod GNU AFFERO GENERAL PUBLIC LICENSE, version 3 kapsamında yayımlanmaktadır. Bir kopyası [`LICENSE`](../LICENSE) dosyasında bulunabilir.

- Copyright (c) Overleaf, 2014-2025.
- Copyright (c) [Pro Authors](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright), 2026-now.

## Sponsorlar
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
