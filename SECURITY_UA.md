# Безпека PDN Game UA

## Для гравців

PDN Game UA не дає іншим гравцям доступ до вашого ПК. Додаток працює як легкий лаунчер спільноти: сервери, новини, Steam-профіль, чат, голос і оновлення.

Безпечні правила:

- Завантажуйте PDN Game UA тільки з офіційного GitHub Release або офіційної сторінки PaDeNa Game UA.
- Не запускайте копії `.exe`, які вам скинули у приватні повідомлення або з невідомих сайтів.
- Перевіряйте SHA256, якщо сумніваєтесь у файлі.
- PDN Game UA не просить і не зберігає пароль Steam.
- Мікрофон використовується тільки після дозволу користувача.

## Що вже захищено в додатку

- Electron працює без `nodeIntegration`, з `contextIsolation`, `sandbox` і забороною webview.
- Зовнішні переходи обмежені Steam/Steam Community.
- Локальний backend слухає `127.0.0.1`, а не всю мережу.
- API приймає тільки локальні host-запити.
- POST/PUT/PATCH/DELETE захищені CSRF-токеном.
- Steam-сесія зберігається в `HttpOnly` cookie.
- Адмін-сесія зберігається в окремій `HttpOnly` cookie.
- Адмін-доступ працює тільки через backend-авторизацію.
- Адмін-вхід має rate-limit.
- Адмін-дії пишуться в `admin-audit.log`; лог має ротацію за розміром.
- Restart endpoint вимагає backend-авторизацію.
- Оновлення приймаються тільки через HTTPS, SHA256 і allowlist доменів.

## Налаштування адмін-доступу

Для production не вшивайте пароль у фронтенд або `.exe`. Налаштовуйте пароль через змінні середовища на машині, де дозволені адмін-дії:

```powershell
$env:PDN_ADMIN_USERS="PDN-Owner,GameAdmin"
$env:PDN_ADMIN_PASSWORD_SHA256="<sha256-of-admin-password>"
```

Для локального тесту можна тимчасово використати:

```powershell
$env:PDN_ADMIN_PASSWORD="your-local-admin-password"
```

Краще використовувати `PDN_ADMIN_PASSWORD_SHA256`, щоб сам пароль не лежав у відкритому вигляді в конфігурації.

Audit log за замовчуванням ротатується після 1 MB і зберігає 5 backup-файлів. За потреби це можна змінити:

```powershell
$env:PDN_ADMIN_AUDIT_MAX_BYTES="1048576"
$env:PDN_ADMIN_AUDIT_BACKUPS="5"
```

## Оновлення

Manifest оновлення повинен містити HTTPS URL, SHA256 і розмір файлу. За замовчуванням дозволені такі хости:

- `wokerkill-rgb.github.io`
- `github.com`
- `objects.githubusercontent.com`
- `release-assets.githubusercontent.com`

Якщо буде власний домен або Cloudflare Pages, додайте його:

```powershell
$env:PDN_UPDATE_ALLOWED_HOSTS="github.com,objects.githubusercontent.com,release-assets.githubusercontent.com,wokerkill-rgb.github.io,pdn-game-ua.pages.dev"
```

З v0.2.0 manifest оновлень підписується Ed25519. Додаток спочатку перевіряє підпис manifest через public key, вшитий у `.exe`, і тільки після цього довіряє URL, версії та SHA256 файлу. Це захищає від сценарію, коли зловмисник намагається підмінити і manifest, і файл оновлення одночасно.

Private key для підпису повинен залишатися тільки на твоїй довіреній машині:

```text
.local-secrets/update-private.pem
```

Цей файл не можна завантажувати в GitHub, Discord, сайт або публічний ZIP. Public key лежить у:

```text
assets/update-public-key.pem
```

Команди для релізу:

```bat
npm run release:manifest
npm run update:sign
npm run update:verify
```

## GitHub Actions CI для релізів

З v0.2.0 додано workflow:

```text
.github/workflows/release.yml
```

Він запускається при push тегу `v*`, збирає `.exe`, рахує SHA256, готує `update.json`, підписує manifest, створює `update.json.sig`, збирає public ZIP і публікує GitHub Release.

Для роботи workflow потрібно додати GitHub Secret:

```text
PDN_UPDATE_PRIVATE_KEY
```

У Secret потрібно вставити повний вміст файлу:

```text
.local-secrets/update-private.pem
```

Це все ще приватний ключ. Його не можна додавати в репозиторій, release assets, Discord або сайт. У GitHub він має бути тільки як Secret.

## RCON для адмін-панелі

RCON підключається тільки на backend-стороні. Пароль RCON не зберігається у JavaScript, HTML, `app-data.json` або GitHub.

Перший Arma Reforger сервер налаштований на локальний RCON:

```json
"rcon": {
  "address": "127.0.0.1",
  "port": 19999,
  "protocol": "tcp-line",
  "passwordEnv": "PDN_RCON_PASSWORD_ARMA_REFORGER_PVE_1",
  "restartCommandEnv": "PDN_RCON_RESTART_COMMAND_ARMA_REFORGER_PVE_1"
}
```

Перед запуском PDN Game UA на машині адміністратора вкажіть:

```powershell
$env:PDN_RCON_PASSWORD_ARMA_REFORGER_PVE_1="your-rcon-password"
$env:PDN_RCON_RESTART_COMMAND_ARMA_REFORGER_PVE_1="restart"
```

`start-admin.cmd` питає RCON пароль для `server-1` обов'язково, а для `server-2` і `server-3` опційно. Якщо server-2/server-3 ще не налаштовані в `app-data.json`, їхні паролі можна пропустити.

Для наступних серверів використовуються окремі змінні:

```powershell
$env:PDN_RCON_PASSWORD_ARMA_REFORGER_PVE_2="server-2-rcon-password"
$env:PDN_RCON_PASSWORD_ARMA_REFORGER_PVE_3="server-3-rcon-password"
$env:PDN_RCON_RESTART_COMMAND_ARMA_REFORGER_PVE_2="restart"
$env:PDN_RCON_RESTART_COMMAND_ARMA_REFORGER_PVE_3="restart"
```

Захист RCON:

- RCON дозволений тільки на `127.0.0.1`, `localhost` або `::1`.
- UI не може передати довільну RCON-команду.
- Кнопка адміна викликає тільки заздалегідь налаштовану restart-команду.
- Кожна спроба RCON пишеться в `admin-audit.log`.

Обмеження `start-admin.cmd`: RCON-пароль вводиться приховано, але під час роботи додатка він існує у змінній середовища процесу. Це нормально для твоєї власної адмін-машини, але не запускайте admin-mode на чужому або недовіреному ПК. Користувачі без прав адміністратора не повинні мати доступ до цієї машини.

## Code signing

Перед масовим релізом бажано купити code signing сертифікат і підписувати `.exe`. Це зменшить попередження Windows SmartScreen. Без реального сертифіката підписати реліз професійно неможливо.

До покупки сертифіката обов'язково публікуйте SHA256 для `.exe` та ZIP у GitHub Release і на офіційній сторінці завантаження.

## Чого не можна робити

- Не приймати файли, моди або скрипти від гравців через додаток без серверної перевірки.
- Не виконувати довільні shell-команди з UI.
- Не зберігати адмін-пароль у JavaScript, HTML або `localStorage`.
- Не відкривати backend на `0.0.0.0` для гравців.
- Не додавати restart-команди без allowlist, ролей і audit log.
