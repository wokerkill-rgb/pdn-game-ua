# PDN Game UA security notes

This prototype has a client-side demo admin password only to show the screen flow.
Production must not trust hidden UI, bundled passwords, or client-side role checks.

Recommended production model:

- Put all admin identity, roles, and permissions on the backend.
- Hash passwords with Argon2id or bcrypt and require 2FA for restart rights.
- Use HTTPS and WSS only.
- Never expose RCON, SSH, or hosting panel credentials to the app.
- Let a small backend worker perform restarts through an allowlist of server IDs.
- Do not accept arbitrary shell commands from the client.
- Add rate limits for login, chat, API calls, and restart actions.
- Log every admin action with admin ID, server ID, timestamp, IP, and result.
- Keep restart workers on a private network or behind a VPN/firewall.
- Publish updates only over HTTPS, require SHA256 verification before install, and add code-signing/signature verification before wide public release.
- Keep voice separate from admin infrastructure.
- Use Steam OpenID only on the backend. The client may display SteamID, nickname, and avatar, but the backend must verify the Steam response before trusting identity.
- Store nickname changes server-side by SteamID. Allow one self-service nickname change, then require an admin-approved request for later changes.
- Use the backend session identity for chat and voice names. Never trust a nickname or SteamID sent only from localStorage.
- Set a real `STEAM_WEB_API_KEY` on the backend host for reliable Steam avatar and persona loading.
- Keep explicit player consent before Steam linking. Do not silently read or infer identity from a running Steam client.
- For Steam desktop-assisted login, use a one-time server token and poll the backend. Do not rely on shared cookies between Steam, the system browser, and the Electron window.
- Persist only the app session token and public Steam profile data on the local device, with a long but finite expiry. Require Steam OpenID again when the remembered session expires.
- Current desktop hardening includes localhost-only host checks, security headers, CSP, CSRF tokens for state-changing requests, restricted Electron navigation, restricted external URL protocols, and microphone-only permission handling for the local app origin.

Safer restart flow:

```text
Admin app -> HTTPS backend -> permission check -> audit log -> restart worker -> game server
```

Never:

```text
Admin app -> direct SSH/RCON from the player's PC
```
