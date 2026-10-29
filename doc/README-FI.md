<h1 align="center">
  <br>
  <a href="https://ayakaleaf-pro.ayaka.space"><img src="logo.png" alt="Ayakaleaf Pro" width="300"></a>
</h1>

<h4 align="center">Overleaf Community Edition laajennettuna kaikilla Pro-ominaisuuksilla <br/>(avoin lähdekoodi, maksuton, itse ylläpidettävissä).</h4>

<p align="center">
  <a href="https://ayakaleaf-pro.ayaka.space">Dokumentaatio</a> •
  <a href="https://github.com/ayaka-notes/ayakaleaf-pro-playground">Playground</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/blog">Blogi</a> •
  <a href="https://github.com/orgs/ayaka-notes/packages/container/package/overleaf-pro">Docker-kuva</a> •
  <a href="https://github.com/ayaka-notes/texlive-full">TeXLive</a> •
  <a href="https://ayakaleaf-pro.ayaka.space/dev">Kehittäjät</a> •
  <a href="#tekijät">Tekijät</a> •
  <a href="#lisenssi">Lisenssi</a>
</p>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README-CS.md">Čeština</a> ·
  <a href="README-DA.md">Dansk</a> ·
  <a href="README-DE.md">Deutsch</a> ·
  <a href="README-ES.md">Español</a> ·
  <b>Suomi</b> ·
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

<img src="screenshot-pro.png" alt="Kuvakaappaus projektin muokkaamisesta Overleaf Community Editionissa">
<p align="center">
  Kuva 1: Kuvakaappaus projektin muokkaamisesta Ayakaleaf Pro Editionissa.
</p>

## Ayakaleaf Pro Edition
Ayakaleaf Pro on Overleafin laajennettu versio, joka sisältää lähes kaikki ominaisuudet ja toiminnot. Lisätietoja on [Ayakaleaf Pro](https://ayakaleaf-pro.ayaka.space) -sivulla. Ayakaleaf Pron ominaisuuksia ovat muun muassa:

- Kaksisuuntainen Dropbox-synkronointi (pidä kaikki projektisi synkronoituina Dropboxin kanssa)
- MCP-palvelin (anna tekoälyagenttien muokata, kääntää ja kommentoida)
- Tekoälykeskusteluavustaja (keskustele, muokkaa ja korjaa tekoälyn avulla)
- Virheavustaja (selitä ja korjaa käännösvirheet)
- Pandoc-tuonti/-vienti (muunna Word-, Markdown- ja LaTeX-muotojen välillä)
- Python-skriptien suoritus (suorita Pythonia projektissasi)
- Kaksisuuntainen GitHub (Enterprise) -synkronointi (push ja pull GitHubin kanssa)
- Kaksisuuntainen GitLab-synkronointi (GitLab.com tai itse ylläpidetty GitLab)
- Kaksisuuntainen Gitea-synkronointi (Gitea.com tai itse ylläpidetty Gitea)
- Zotero-integraatio (Zotero OAuth -tuella)
- Mendeley-integraatio (Mendeley OAuth -tuella)
- Edistynyt viitehaku (hae kaikista Bib-merkinnöistäsi)
- Git-Bridge-tuki (clone, pull ja push Gitillä)
- Hallintapaneeli (käyttäjien ja projektien keskitetty hallinta)
- SSO LDAP:n ja SAML:n tai OAuth 2.0:n kautta
- Rajoittamaton käännösaika (säädettävissä hallintapaneelissa)
- Omatoiminen rekisteröityminen (valinnainen, voidaan rajata sähköpostiverkkotunnuksen mukaan)
- Hiekkalaatikossa kääntäminen ([texlive-full](https://github.com/ayaka-notes/texlive-full)-kuvan tuella)
- Mallijärjestelmä (mallivalikoimalla)
- Muutosten seuranta (tarkistus- ja kommenttipaneelilla)
- Täydellinen projektihistoria (palautus ja lataus)
- Symbolipaletti (lisää matemaattisia symboleja yhdellä napsautuksella)
- Täydellinen i18n-käännös (jokainen käyttöliittymän teksti 18 kielellä)
- ARM-tuki (x86_64/arm64 Dockerilla)

Viimeisenä mutta ei vähäisimpänä: Ayakaleaf Pro on avointa lähdekoodia, ja sitä saa käyttää ja muokata maksutta. Voit ylläpitää sitä itse ja osallistua Ayakaleaf Pron kehitykseen. Lisätietoja on [Kehittäjädokumentaatio](https://ayakaleaf-pro.ayaka.space/dev)-sivulla.

> [!NOTE]
> Huomautus: Ayakaleaf Pro ei ole sidoksissa Overleaf, Inc.:iin eikä sen emoyhtiöön Digital Scienceen. Se ei myöskään ole *Server Pro* Edition, joka on Overleaf, Inc.:n tarjoama kaupallinen tuote.
> 
> Ayakaleaf Pro on itsenäinen projekti, jota kehittää ja ylläpitää [ayaka-notes](https://github.com/ayaka-notes).

## Asennus

Jos haluat vain kokeilla Ayakaleaf Prota ilman oman palvelimen pystyttämistä, voit käyttää [Ayakaleaf Pro Playground](https://github.com/ayaka-notes/ayakaleaf-pro-playground) -ympäristöämme. Se tarjoaa valmiiksi määritetyn GitHub Codespaces -ympäristön, jossa voit käynnistää ja tutkia Ayakaleaf Prota suoraan selaimessasi.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ayaka-notes/ayakaleaf-pro-playground)

Jos haluat ottaa Ayakaleaf Pron tuotantokäyttöön, yksityiskohtaiset asennusohjeet löytyvät [Dokumentaatio](https://ayakaleaf-pro.ayaka.space/)-sivulta. Suosittelemme vahvasti Ayakaleaf Pron asentamista [ayaka-notes/Toolkit](https://github.com/ayaka-notes/toolkit/) -työkalulla.

## Päivittäminen

Jos päivität Ayakaleaf Pron aiemmasta versiosta, katso [Releases-sivulta](https://github.com/ayaka-notes/ayakaleaf-pro/releases) kunkin version muutokset nykyisen versiosi ja kohdeversion väliltä.

## Käännökset

Otamme mielellämme vastaan Ayakaleaf Pron käännöksiä koskevia kontribuutioita. Yleensä käytämme claude/codexia englanninkielisen tekstin kääntämiseen muille kielille. Jos löydät käännöksistä virheitä, lähetä pull request niiden korjaamiseksi. Muokkaa vain asiaankuuluvia tiedostoja kansiossa `services/web/locales/locales_patches`.

Hakemiston `services/web/locales/` tiedostot ovat Overleafin virallisia käännöstiedostoja. Älä muokkaa niitä suoraan.

## Osallistuminen

Katso [CONTRIBUTING](../CONTRIBUTING.md)-tiedostosta tietoa Overleafin kehitykseen osallistumisesta.

## Blogi
Kirjoitamme Overleafin sisäisestä toiminnasta, käännösten suorituskyvystä ja itse ylläpidetystä LaTeX-infrastruktuurista. Lue lisää blogistamme:
- [2026.08 Overleaf Server Pro Price and Open-Source Alternative](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-server-pro-price-and-open-source-alternative)
- [2026.08 Overleaf Benchmark: A Deep Research of Concurrent LaTeX Compilation in Overleaf](https://ayakaleaf-pro.ayaka.space/blog/2026/overleaf-benchmark)

## Tekijät

- [Overleaf-tiimi](https://www.overleaf.com/about)
- [Ominaisuudet ja tekijänoikeudet](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright)

## Lisenssi

Tämän repositorion koodi on julkaistu GNU AFFERO GENERAL PUBLIC LICENSE, version 3 -lisenssillä. Kopio löytyy tiedostosta [`LICENSE`](../LICENSE).

- Copyright (c) Overleaf, 2014-2025.
- Copyright (c) [Pro Authors](https://ayakaleaf-pro.ayaka.space/on-premises/readme/features-and-copyright), 2026-now.

## Sponsorit
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
