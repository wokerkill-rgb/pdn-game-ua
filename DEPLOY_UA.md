# Публікація сторінки PDN Game UA

## Що куди завантажувати

Великі файли публікуються тільки як GitHub Release assets:

```text
PDN Game UA 0.2.0.exe
PDN_Game_UA_Setup_0.2.0.exe
PDN_Game_UA_0.2.0_Public.zip
```

У GitHub Pages завантажуються тільки легкі файли сайту:

```text
index.html
download/index.html
download/assets/app.ico
download/assets/game-hero.png
downloads/pdn-game-ua/update.json
downloads/pdn-game-ua/update.json.sig
.nojekyll
DEPLOY_UA.md
README_UPLOAD_UA.md
```

Не завантажуй `.exe` або `PDN_Game_UA_0.2.0_Public.zip` напряму в GitHub Pages через web upload. GitHub часто відхиляє файли більше 25 MB, і для оновлень безпечніше тримати великі файли в Releases.

## GitHub Pages

Репозиторій:

```text
https://github.com/wokerkill-rgb/pdn-game-ua
```

Налаштування:

```text
Settings -> Pages
Source: Deploy from a branch
Branch: main
Folder: /root
```

Сторінка буде тут:

```text
https://wokerkill-rgb.github.io/pdn-game-ua/
```

Окрема сторінка завантаження:

```text
https://wokerkill-rgb.github.io/pdn-game-ua/download/
```

## Автоматичний реліз через GitHub Actions

Workflow:

```text
.github/workflows/release.yml
```

Перед першим автоматичним релізом створи GitHub Secret:

```text
Settings -> Secrets and variables -> Actions -> New repository secret
Name: PDN_UPDATE_PRIVATE_KEY
Value: повний вміст .local-secrets/update-private.pem
```

Після цього реліз запускається тегом:

```bat
git tag v0.2.1
git push origin v0.2.1
```

Workflow сам:

- збирає portable `.exe`;
- збирає NSIS installer;
- рахує SHA256 `.exe`;
- створює `update.json`;
- підписує `update.json.sig`;
- перевіряє manifest;
- збирає `PDN_Game_UA_VERSION_Public.zip`;
- додає installer hash у сайт і release notes;
- оновлює `index.html` і `download/index.html`;
- збирає `PDN_Game_UA_VERSION_Website_Update_Lite_Files.zip`;
- публікує GitHub Release.

## Ручна підготовка сайту

Якщо потрібно підготувати сайт локально:

```bat
npm run release:manifest
npm run update:sign
npm run update:verify
npm run release:website
npm run release:website:stage
```

Після цього папка буде тут:

```text
dist/PDN_Game_UA_VERSION_Website_Update_Lite_Files
```

Її вміст можна завантажувати в GitHub Pages.

## Що перевірити після публікації

- Кнопка `Завантажити ZIP` відкриває GitHub Release asset.
- Кнопка `Installer` відкриває `PDN_Game_UA_Setup_VERSION.exe`.
- Кнопка `Скачати .exe` відкриває прямий `.exe` з GitHub Release.
- `/download/` відкривається без 404.
- `downloads/pdn-game-ua/update.json` відкривається.
- `downloads/pdn-game-ua/update.json.sig` відкривається.
- SHA256 на сторінці збігається з GitHub Release notes.
