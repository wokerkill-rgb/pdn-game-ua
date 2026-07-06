# Публікація сторінки PDN Game UA

Для GitHub Pages завантажуйте тільки легкі файли сайту:

```text
index.html
download/index.html
download/assets/app.ico
download/assets/game-hero.png
downloads/pdn-game-ua/update.json
.nojekyll
DEPLOY_UA.md
```

Не завантажуйте великий `.exe` або `PDN_Game_UA_0.2.0_Public.zip` прямо в GitHub Pages через web upload. GitHub часто відхиляє файли більше 25 MB. Великі файли потрібно публікувати як GitHub Release assets.

## GitHub Release v0.2.0

Створи release з тегом:

```text
v0.2.0
```

Завантаж у release assets:

```text
PDN_Game_UA_0.2.0_Public.zip
PDN Game UA 0.2.0.exe
```

Release notes:

```text
PDN Game UA 0.2.0

Code changes:
- update manifest тепер підписується Ed25519.
- Додаток перевіряє підпис manifest перед SHA256 перевіркою exe.

Security/docs:
- Private update key залишається тільки локально у .local-secrets.
- SHA256 для exe і zip опубліковано нижче.

SHA256 exe:
73858094F35087551252E698199571A667BEA2C05581CB3E5F06DE286675518E

SHA256 zip:
9430DC551729FB7F8E3A78F722F6A53E5FAAB3CEBBA13EEE481F971B28DDAC45
```

## GitHub Pages

Рекомендована назва репозиторію:

```text
pdn-game-ua
```

1. Завантаж легкі файли сайту в репозиторій `https://github.com/wokerkill-rgb/pdn-game-ua`.
2. У GitHub відкрий:

```text
Settings -> Pages
```

3. Вибери:

```text
Source: Deploy from a branch
Branch: main
Folder: /root
```

Після публікації сторінка буде тут:

```text
https://wokerkill-rgb.github.io/pdn-game-ua/
```

## Автооновлення

Поточний manifest:

```text
https://wokerkill-rgb.github.io/pdn-game-ua/downloads/pdn-game-ua/update.json
```

Manifest v0.2.0 вказує на `.exe` у GitHub Release:

```text
https://github.com/wokerkill-rgb/pdn-game-ua/releases/download/v0.2.0/PDN%20Game%20UA%200.2.0.exe
```

Важливо: manifest у v0.2.0 підписаний Ed25519. Перед публікацією release завжди запускай:

```bat
npm run release:manifest
npm run update:sign
npm run update:verify
```

## Автоматичний реліз через GitHub Actions

У проєкті є workflow:

```text
.github/workflows/release.yml
```

Щоб він працював, у GitHub відкрий:

```text
Settings -> Secrets and variables -> Actions -> New repository secret
```

Створи Secret:

```text
PDN_UPDATE_PRIVATE_KEY
```

У значення встав повний вміст локального файлу:

```text
.local-secrets/update-private.pem
```

Після цього реліз запускається тегом:

```bat
git tag v0.2.1
git push origin v0.2.1
```

Workflow сам збере `.exe`, порахує SHA256, підпише `update.json`, створить `update.json.sig` і опублікує GitHub Release.
