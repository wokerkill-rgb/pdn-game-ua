# PDN Game UA

Lightweight launcher prototype for PaDeNa Game UA servers.

## Start on Windows

Double-click:

```bat
start-pdn-game-ua.cmd
```

Or run:

```bat
npm start
```

Then open:

```text
http://127.0.0.1:4173/
```

## Portable install

You can place the portable exe in a server tools folder, for example:

```text
G:\Server_Program\PDN Game UA.exe
```

When running as a portable app, PDN Game UA stores remembered Steam sessions and local app state next to the exe:

```text
G:\Server_Program\PDN_Game_UA_Data\pdn-state.json
```

If Windows blocks writing to that folder, the app falls back to the normal Electron user-data folder.

## Desktop shortcut

Run this helper to create a desktop shortcut with the app icon:

```bat
create-pdn-game-ua-shortcut.cmd
```

The helper can be placed next to `PDN Game UA.exe` in `G:\Server_Program` or run from the project folder where `dist` exists. It creates:

```text
Desktop\PDN Game UA.lnk
```

## Player download and updates

For public distribution, upload these files to your website or hosting:

```text
downloads/pdn-game-ua/PDN Game UA 0.2.0.exe
downloads/pdn-game-ua/update.json
```

Players only need the download link to the exe. Later, when you release a new version, update `website/downloads/pdn-game-ua/update.json` with:

- the new `version`
- the HTTPS `url` to the new exe
- the real SHA256 hash of the new exe
- the file `size` in bytes

The in-app `Update` button checks the manifest, downloads the new portable exe, verifies SHA256, replaces the old exe after PDN Game UA closes, and starts the new version.

Default update manifest URL:

```text
https://wokerkill-rgb.github.io/pdn-game-ua/downloads/pdn-game-ua/update.json
```

Set `PDN_UPDATE_MANIFEST_URL` before building/running if your real domain is different.

Since v0.2.0 the update manifest is signed with Ed25519. PDN Game UA verifies the manifest signature first, then verifies the downloaded exe with SHA256. The private update signing key must stay outside GitHub in `.local-secrets/update-private.pem`.

Useful release commands:

```bat
npm run update:keys
npm run release:manifest
npm run update:sign
npm run update:verify
```

## GitHub Actions release

The workflow `.github/workflows/release.yml` builds and publishes a release automatically when you push a tag like:

```bat
git tag v0.2.1
git push origin v0.2.1
```

Before using it, add this GitHub Secret:

```text
PDN_UPDATE_PRIVATE_KEY
```

The value must be the full contents of:

```text
.local-secrets/update-private.pem
```

The workflow builds the portable exe, calculates SHA256, prepares and signs `update.json`, creates `update.json.sig`, creates the public ZIP, and publishes everything to GitHub Releases.

## Security hardening

The desktop build includes local-only host checks, security headers, CSP, CSRF protection for POST requests, restricted Electron navigation, restricted external URL protocols, and microphone-only permission handling for the local app origin.

## PDN Mini Games

The sidebar includes a `PDN Mini Games` hub below News. The first planned game is `Durak`, with additional slots prepared for Checkers and Dominoes. Game logic is intentionally separate from server controls so future mini-games can be added without touching admin/server infrastructure.

## Edit servers and news

Main editable data lives in:

```text
data/app-data.json
```

Use this file to add or remove:

- servers
- text channel names
- voice channel names
- starter chat messages
- activity items
- news

## Steam profile prototype

The app now has a Steam profile block in the sidebar. In this prototype `/api/auth/steam-demo` returns demo Steam data so the UI can use one player name in chat and voice.

The next-step backend now includes Steam OpenID routes:

- `/api/auth/steam`
- `/api/auth/steam/callback`
- `/api/profile`
- `/api/profile/nickname`

Set `STEAM_WEB_API_KEY` before starting the app to fetch persona names and avatars through the official Steam Web API. Without the key, the backend falls back to Steam Community XML when it is available. Nickname rules are enforced by SteamID: one self-service change, then admin approval for later changes.

Before redirecting to Steam, the launcher shows a consent screen explaining that only SteamID, nickname, and avatar are used. The app does not silently read identity from a running Steam client.

For desktop login, the app creates a one-time login token, opens Steam through `steam://openurl/...`, and polls `/api/auth/steam/status`. This lets an already-open Steam client complete the confirmation without sharing Steam cookies with the Electron window.

After the first successful Steam confirmation, PDN Game UA remembers the device for 180 days by storing a backend session in the app user-data folder. On the next app launch, `/api/profile` restores the Steam profile automatically.

## Current servers

- `[UA/EU] Ukrainian Project *PaDeNa Game UA* server -1- [PVE]`
  - Game port: `89.105.236.63:2001`
  - A2S port: `17777`

- `[UA/EU] Ukrainian Project *PaDeNa Game UA* server -2- [PVE]`
  - Game port: `89.105.236.63:2002`
  - A2S port: `17778`

## Production notes

Run `start-admin.cmd` only on your trusted admin/server PC. It asks for the PDN admin password and RCON password for server-1, with optional RCON passwords for server-2 and server-3. RCON passwords are kept out of GitHub and app files, but while admin mode is running they exist in the process environment of that local session.

Before a wider public release, buy a code signing certificate for the `.exe`. Until then, publish SHA256 hashes on the GitHub Release and download page. Ed25519 manifest signing protects app updates, but it does not replace Windows code signing or SmartScreen reputation.
