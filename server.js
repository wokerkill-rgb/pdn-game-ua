const http = require("http");
const https = require("https");
const childProcess = require("child_process");
const crypto = require("crypto");
const dgram = require("dgram");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { canonicalUpdateManifest } = require("./lib/update-signing.cjs");

const root = __dirname;
const packageInfo = require("./package.json");
const appVersion = packageInfo.version || "0.0.0";
const defaultUpdateManifestUrl = "https://wokerkill-rgb.github.io/pdn-game-ua/downloads/pdn-game-ua/update.json";
const updatePublicKeyPath = path.join(root, "assets", "update-public-key.pem");
const sessionMaxAgeSeconds = 60 * 60 * 24 * 180;
const adminAuditMaxBytes = Number(process.env.PDN_ADMIN_AUDIT_MAX_BYTES || 1024 * 1024);
const adminAuditBackups = Math.max(1, Math.min(10, Number(process.env.PDN_ADMIN_AUDIT_BACKUPS || 5)));
const sessions = new Map();
const profilesBySteamId = new Map();
const pendingSteamLogins = new Map();
const csrfTokens = new Map();
const adminSessions = new Map();
const adminLoginAttempts = new Map();
const nicknameRequests = [];
let persistentStateLoaded = false;

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml; charset=utf-8"
};

function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), geolocation=(), microphone=(self)",
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "media-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self' https://steamcommunity.com"
    ].join("; "),
    ...extra
  };
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    ...securityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendHtml(res, status, html, headers = {}) {
  res.writeHead(status, {
    ...securityHeaders(),
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(html);
}

function redirect(res, location, headers = {}) {
  res.writeHead(302, {
    ...securityHeaders(),
    Location: location,
    "Cache-Control": "no-store",
    ...headers
  });
  res.end();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

function getStateDir() {
  if (process.env.PDN_STATE_DIR) return process.env.PDN_STATE_DIR;
  if (process.env.PDN_USER_DATA) return process.env.PDN_USER_DATA;
  const base = process.env.APPDATA || process.env.LOCALAPPDATA || os.homedir();
  return path.join(base, "PDN Game UA");
}

function getStateFile() {
  return path.join(getStateDir(), "pdn-state.json");
}

function loadPersistentState() {
  if (persistentStateLoaded) return;
  persistentStateLoaded = true;

  try {
    const state = JSON.parse(fs.readFileSync(getStateFile(), "utf8"));
    Object.entries(state.profiles || {}).forEach(([steamId, profile]) => {
      profilesBySteamId.set(steamId, profile);
    });
    Object.entries(state.sessions || {}).forEach(([token, session]) => {
      const profile = profilesBySteamId.get(session.steamId);
      if (profile) {
        sessions.set(token, {
          profile,
          createdAt: session.createdAt || Date.now()
        });
      }
    });
    (state.nicknameRequests || []).forEach((request) => nicknameRequests.push(request));
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("PDN Game UA state load failed.", error.message);
  }
}

function savePersistentState() {
  try {
    fs.mkdirSync(getStateDir(), { recursive: true });
    const profiles = Object.fromEntries(profilesBySteamId.entries());
    const persistedSessions = {};
    sessions.forEach((session, token) => {
      const profile = session.profile || session;
      if (!profile?.steamId) return;
      persistedSessions[token] = {
        steamId: profile.steamId,
        createdAt: session.createdAt || Date.now()
      };
    });
    fs.writeFileSync(getStateFile(), JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      profiles,
      sessions: persistedSessions,
      nicknameRequests
    }, null, 2), "utf8");
  } catch (error) {
    console.warn("PDN Game UA state save failed.", error.message);
  }
}

function pruneExpiredSessions() {
  const expiresAfterMs = sessionMaxAgeSeconds * 1000;
  const now = Date.now();
  let changed = false;
  sessions.forEach((session, token) => {
    if (session.createdAt && now - session.createdAt > expiresAfterMs) {
      sessions.delete(token);
      changed = true;
    }
  });
  if (changed) savePersistentState();
}

function buildBaseUrl(req) {
  const host = req.headers.host || "127.0.0.1:4173";
  return `http://${host}`;
}

function isAllowedHost(req) {
  try {
    const host = new URL(buildBaseUrl(req)).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function isSameOriginRequest(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(buildBaseUrl(req)).origin;
  } catch {
    return false;
  }
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((item) => {
    const index = item.indexOf("=");
    if (index === -1) return [item.trim(), ""];
    return [item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1).trim())];
  }));
}

function setCsrfCookie(token) {
  return `pdn_csrf=${encodeURIComponent(token)}; SameSite=Strict; Path=/; Max-Age=86400`;
}

function createCsrfToken() {
  const token = crypto.randomBytes(32).toString("hex");
  csrfTokens.set(token, Date.now());
  return token;
}

function cleanupCsrfTokens() {
  const now = Date.now();
  csrfTokens.forEach((createdAt, token) => {
    if (now - createdAt > 24 * 60 * 60 * 1000) csrfTokens.delete(token);
  });
}

function validateCsrf(req) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return true;
  if (!isSameOriginRequest(req)) return false;
  cleanupCsrfTokens();
  const cookieToken = parseCookies(req).pdn_csrf;
  const headerToken = req.headers["x-pdn-csrf"];
  return Boolean(cookieToken && headerToken && cookieToken === headerToken && csrfTokens.has(cookieToken));
}

function getSession(req) {
  loadPersistentState();
  pruneExpiredSessions();
  const token = parseCookies(req).pdn_session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  return session.profile || session;
}

function setSessionCookie(token) {
  return `pdn_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionMaxAgeSeconds}`;
}

function setAdminCookie(token) {
  return `pdn_admin=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`;
}

function clearAdminCookie() {
  return "pdn_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
}

function createSession(profile) {
  loadPersistentState();
  const savedProfile = profilesBySteamId.get(profile.steamId) || {
    steamId: profile.steamId,
    steamName: profile.steamName,
    displayName: profile.displayName || profile.steamName,
    avatar: profile.avatar || "",
    nicknameChanged: false,
    pendingNickname: ""
  };

  savedProfile.steamName = profile.steamName || savedProfile.steamName;
  savedProfile.avatar = profile.avatar || savedProfile.avatar;
  if (!savedProfile.displayName) savedProfile.displayName = savedProfile.steamName;
  profilesBySteamId.set(savedProfile.steamId, savedProfile);

  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    profile: savedProfile,
    createdAt: Date.now()
  });
  savePersistentState();
  return { token, profile: savedProfile };
}

function publicProfile(profile) {
  if (!profile) return null;
  return {
    steamId: profile.steamId,
    steamName: profile.steamName,
    displayName: profile.displayName,
    avatar: profile.avatar,
    nicknameChanged: Boolean(profile.nicknameChanged),
    pendingNickname: profile.pendingNickname || ""
  };
}

function getClientKey(req) {
  return req.socket?.remoteAddress || "local";
}

function getAdminUsers() {
  return (process.env.PDN_ADMIN_USERS || "PDN-Owner,GameAdmin,admin")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAdminPasswordHash() {
  const configuredHash = String(process.env.PDN_ADMIN_PASSWORD_SHA256 || "").trim().toLowerCase();
  if (/^[a-f0-9]{64}$/.test(configuredHash)) return configuredHash;
  const configuredPassword = String(process.env.PDN_ADMIN_PASSWORD || "").trim();
  if (!configuredPassword) return "";
  return crypto.createHash("sha256").update(configuredPassword, "utf8").digest("hex");
}

function isAdminConfigured() {
  return Boolean(getAdminPasswordHash());
}

function timingSafeHexEqual(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function isAdminRateLimited(req) {
  const key = getClientKey(req);
  const attempt = adminLoginAttempts.get(key);
  if (!attempt) return false;
  if (attempt.lockedUntil && Date.now() < attempt.lockedUntil) return true;
  if (attempt.lockedUntil && Date.now() >= attempt.lockedUntil) adminLoginAttempts.delete(key);
  return false;
}

function recordAdminLoginFailure(req) {
  const key = getClientKey(req);
  const attempt = adminLoginAttempts.get(key) || { count: 0, lockedUntil: 0 };
  attempt.count += 1;
  if (attempt.count >= 5) {
    attempt.count = 0;
    attempt.lockedUntil = Date.now() + 15 * 60 * 1000;
  }
  adminLoginAttempts.set(key, attempt);
}

function clearAdminLoginFailures(req) {
  adminLoginAttempts.delete(getClientKey(req));
}

function verifyAdminCredentials(name, password) {
  if (!isAdminConfigured()) return false;
  if (!getAdminUsers().includes(name)) return false;
  const providedHash = crypto.createHash("sha256").update(String(password || ""), "utf8").digest("hex");
  return timingSafeHexEqual(providedHash, getAdminPasswordHash());
}

function createAdminSession(name) {
  const token = crypto.randomBytes(32).toString("hex");
  adminSessions.set(token, {
    name,
    createdAt: Date.now()
  });
  return token;
}

function getAdminSession(req) {
  const token = parseCookies(req).pdn_admin;
  if (!token) return null;
  const session = adminSessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > 60 * 60 * 1000) {
    adminSessions.delete(token);
    return null;
  }
  return session;
}

function rotateAdminAuditLog(file) {
  if (!adminAuditMaxBytes || adminAuditMaxBytes < 1024) return;
  try {
    const stat = fs.statSync(file);
    if (stat.size < adminAuditMaxBytes) return;

    for (let index = adminAuditBackups; index >= 1; index -= 1) {
      const source = `${file}.${index}`;
      const target = `${file}.${index + 1}`;
      if (!fs.existsSync(source)) continue;
      if (index === adminAuditBackups) fs.unlinkSync(source);
      else fs.renameSync(source, target);
    }

    fs.renameSync(file, `${file}.1`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function appendAdminAudit(event, details = {}) {
  try {
    fs.mkdirSync(getStateDir(), { recursive: true });
    const auditFile = path.join(getStateDir(), "admin-audit.log");
    rotateAdminAuditLog(auditFile);
    fs.appendFileSync(auditFile, `${JSON.stringify({
      time: new Date().toISOString(),
      event,
      ...details
    })}\n`, "utf8");
  } catch (error) {
    console.warn("PDN Game UA admin audit write failed.", error.message);
  }
}

function toEnvId(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isLoopbackRconAddress(address) {
  const value = String(address || "").trim().toLowerCase();
  return value === "127.0.0.1" || value === "localhost" || value === "::1";
}

function getServerRconConfig(server) {
  const rcon = server?.rcon || {};
  const envId = toEnvId(server?.id);
  const address = String(rcon.address || process.env[`PDN_RCON_ADDRESS_${envId}`] || "127.0.0.1").trim();
  const port = Number(rcon.port || process.env[`PDN_RCON_PORT_${envId}`] || 0);
  const passwordEnv = String(rcon.passwordEnv || `PDN_RCON_PASSWORD_${envId}`);
  const commandEnv = String(rcon.restartCommandEnv || `PDN_RCON_RESTART_COMMAND_${envId}`);
  const password = String(process.env[passwordEnv] || process.env.PDN_RCON_PASSWORD || "");
  const restartCommand = String(process.env[commandEnv] || process.env.PDN_RCON_RESTART_COMMAND || rcon.restartCommand || "restart").trim();
  const protocol = String(process.env[`PDN_RCON_PROTOCOL_${envId}`] || process.env.PDN_RCON_PROTOCOL || rcon.protocol || "tcp-line").trim().toLowerCase();

  if (!server?.rcon) throw new Error("RCON is not configured for this server");
  if (!isLoopbackRconAddress(address)) throw new Error("RCON address must be local: 127.0.0.1");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("RCON port is invalid");
  if (!password) throw new Error(`RCON password is missing: set ${passwordEnv}`);
  if (!["tcp-line"].includes(protocol)) throw new Error(`RCON protocol is not allowed: ${protocol}`);
  if (!restartCommand || restartCommand.length > 80 || /[\r\n;]/.test(restartCommand)) {
    throw new Error("RCON restart command is invalid");
  }

  return {
    address,
    port,
    password,
    passwordEnv,
    protocol,
    restartCommand
  };
}

function sendTcpLineRconCommand(config) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.address, port: config.port });
    let response = "";
    let settled = false;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };

    socket.setEncoding("utf8");
    socket.setTimeout(6000, () => finish(new Error("RCON timeout")));
    socket.on("connect", () => {
      socket.write(`${config.password}\n${config.restartCommand}\n`);
    });
    socket.on("data", (chunk) => {
      response += chunk;
      if (response.length > 8192) response = response.slice(-8192);
    });
    socket.on("error", (error) => finish(error));
    socket.on("end", () => finish(null, { response: response.trim() }));
    socket.on("close", () => finish(null, { response: response.trim() }));
  });
}

async function restartServerViaRcon(server, admin, req) {
  const config = getServerRconConfig(server);
  appendAdminAudit("admin-rcon-restart-start", {
    ip: getClientKey(req),
    name: admin.name,
    serverId: server.id,
    serverName: server.name,
    rconAddress: config.address,
    rconPort: config.port,
    rconProtocol: config.protocol
  });

  if (config.protocol === "tcp-line") {
    const result = await sendTcpLineRconCommand(config);
    appendAdminAudit("admin-rcon-restart-sent", {
      ip: getClientKey(req),
      name: admin.name,
      serverId: server.id,
      serverName: server.name,
      rconAddress: config.address,
      rconPort: config.port,
      rconProtocol: config.protocol,
      responsePreview: String(result.response || "").slice(0, 200)
    });
    return result;
  }

  throw new Error(`Unsupported RCON protocol: ${config.protocol}`);
}

function sanitizeNickname(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 32);
}

function httpsText(url, options = {}, body = "") {
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(url);
    if (requestUrl.protocol !== "https:") {
      reject(new Error("Only HTTPS update/auth requests are allowed"));
      return;
    }

    const request = https.request(requestUrl, options, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        const nextUrl = new URL(response.headers.location, requestUrl).toString();
        httpsText(nextUrl, options, body).then(resolve, reject);
        return;
      }

      let data = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        data += chunk;
      });
      response.on("end", () => resolve({ statusCode: response.statusCode, body: data }));
    });
    request.setTimeout(8000, () => {
      request.destroy(new Error("request timeout"));
    });
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function getUpdateManifestUrl() {
  return process.env.PDN_UPDATE_MANIFEST_URL || defaultUpdateManifestUrl;
}

function getAllowedUpdateHosts() {
  return new Set((process.env.PDN_UPDATE_ALLOWED_HOSTS || [
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "wokerkill-rgb.github.io"
  ].join(","))
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean));
}

function shouldRequireUpdateSignature() {
  return process.env.PDN_UPDATE_REQUIRE_SIGNATURE !== "0";
}

function readUpdatePublicKey() {
  return fs.readFileSync(updatePublicKeyPath, "utf8");
}

function verifyUpdateManifestSignature(manifest) {
  if (!shouldRequireUpdateSignature()) return;

  const signature = manifest?.signature || {};
  const algorithm = String(signature.algorithm || "").trim().toLowerCase();
  const value = String(signature.value || "").trim();

  if (algorithm !== "ed25519") {
    throw new Error("Update manifest signature is missing or unsupported");
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(value)) {
    throw new Error("Update manifest signature is invalid");
  }

  const payload = Buffer.from(canonicalUpdateManifest(manifest), "utf8");
  const publicKey = crypto.createPublicKey(readUpdatePublicKey());
  const ok = crypto.verify(null, payload, publicKey, Buffer.from(value, "base64"));
  if (!ok) throw new Error("Update manifest signature verification failed");
}

function assertAllowedUpdateUrl(url) {
  const parsedUrl = url instanceof URL ? url : new URL(url);
  if (parsedUrl.protocol !== "https:") throw new Error("Update URL must use HTTPS");
  if (!getAllowedUpdateHosts().has(parsedUrl.hostname.toLowerCase())) {
    throw new Error(`Update host is not allowed: ${parsedUrl.hostname}`);
  }
  return parsedUrl;
}

function compareVersions(left, right) {
  const a = String(left || "0").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const b = String(right || "0").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(a.length, b.length, 3);
  for (let index = 0; index < length; index += 1) {
    if ((a[index] || 0) > (b[index] || 0)) return 1;
    if ((a[index] || 0) < (b[index] || 0)) return -1;
  }
  return 0;
}

function normalizeUpdateManifest(manifest) {
  verifyUpdateManifestSignature(manifest);

  const file = manifest?.files?.winPortable || manifest?.winPortable || manifest || {};
  const version = String(manifest.version || file.version || "").trim();
  const url = String(file.url || manifest.downloadUrl || "").trim();
  const sha256 = String(file.sha256 || manifest.sha256 || "").trim().toLowerCase();

  if (!version) throw new Error("Update manifest has no version");
  if (!url) throw new Error("Update manifest has no download URL");
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Update manifest has no valid SHA256");

  const parsedUrl = assertAllowedUpdateUrl(url);

  return {
    appId: manifest.appId || "ua.padena.pdngameua",
    version,
    notes: manifest.notes || "",
    releaseDate: manifest.releaseDate || "",
    url: parsedUrl.toString(),
    sha256,
    size: Number(file.size || manifest.size || 0)
  };
}

async function readUpdateManifest() {
  assertAllowedUpdateUrl(getUpdateManifestUrl());
  const response = await httpsText(getUpdateManifestUrl(), {
    method: "GET",
    headers: {
      "Accept": "application/json"
    }
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Update manifest returned HTTP ${response.statusCode}`);
  }
  return normalizeUpdateManifest(JSON.parse(response.body));
}

async function getUpdateStatus() {
  const manifestUrl = getUpdateManifestUrl();
  try {
    const update = await readUpdateManifest();
    return {
      ok: true,
      configured: true,
      currentVersion: appVersion,
      latestVersion: update.version,
      updateAvailable: compareVersions(update.version, appVersion) > 0,
      releaseDate: update.releaseDate,
      notes: update.notes,
      size: update.size,
      manifestUrl
    };
  } catch (error) {
    return {
      ok: false,
      configured: Boolean(manifestUrl),
      currentVersion: appVersion,
      latestVersion: appVersion,
      updateAvailable: false,
      manifestUrl,
      error: error.message
    };
  }
}

function getPortableExecutableFile() {
  return process.env.PORTABLE_EXECUTABLE_FILE || (process.env.PORTABLE_EXECUTABLE_DIR
    ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, "PDN Game UA.exe")
    : "");
}

function downloadFileWithSha256(url, destination, expectedSha256, maxBytes = 350 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let requestUrl;
    try {
      requestUrl = assertAllowedUpdateUrl(url);
    } catch (error) {
      reject(error);
      return;
    }

    const request = https.get(requestUrl, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        const nextUrl = new URL(response.headers.location, requestUrl).toString();
        downloadFileWithSha256(nextUrl, destination, expectedSha256, maxBytes).then(resolve, reject);
        return;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Update download returned HTTP ${response.statusCode}`));
        return;
      }

      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const hash = crypto.createHash("sha256");
      const file = fs.createWriteStream(destination);
      let totalBytes = 0;

      response.on("data", (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          request.destroy(new Error("Update file is too large"));
          return;
        }
        hash.update(chunk);
      });

      response.pipe(file);
      file.on("finish", () => {
        file.close(() => {
          const actualSha256 = hash.digest("hex");
          if (actualSha256 !== expectedSha256) {
            fs.rm(destination, { force: true }, () => {});
            reject(new Error("Update SHA256 verification failed"));
            return;
          }
          resolve({ bytes: totalBytes, sha256: actualSha256 });
        });
      });
      file.on("error", reject);
    });

    request.setTimeout(60000, () => request.destroy(new Error("Update download timeout")));
    request.on("error", reject);
  });
}

function writePortableUpdaterScript(targetExe, downloadedExe, version) {
  const updateDir = path.join(getStateDir(), "updates");
  const scriptPath = path.join(updateDir, "pdn-update.ps1");
  const escapedTarget = targetExe.replace(/'/g, "''");
  const escapedDownload = downloadedExe.replace(/'/g, "''");
  const escapedVersion = version.replace(/'/g, "''");
  const script = `
$ErrorActionPreference = 'Stop'
$target = '${escapedTarget}'
$download = '${escapedDownload}'
$backup = "$target.bak"
$log = Join-Path (Split-Path -Parent $download) 'pdn-update.log'
Start-Sleep -Seconds 2
for ($i = 0; $i -lt 120; $i++) {
  try {
    $stream = [System.IO.File]::Open($target, 'OpenOrCreate', 'ReadWrite', 'None')
    $stream.Close()
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}
try {
  if (Test-Path $backup) { Remove-Item -LiteralPath $backup -Force }
  if (Test-Path $target) { Move-Item -LiteralPath $target -Destination $backup -Force }
  Move-Item -LiteralPath $download -Destination $target -Force
  Add-Content -LiteralPath $log -Value "Updated PDN Game UA to ${escapedVersion} at $(Get-Date -Format o)"
  Start-Process -FilePath $target
} catch {
  Add-Content -LiteralPath $log -Value "Update failed at $(Get-Date -Format o): $($_.Exception.Message)"
  if ((Test-Path $backup) -and -not (Test-Path $target)) {
    Move-Item -LiteralPath $backup -Destination $target -Force
  }
  if (Test-Path $target) { Start-Process -FilePath $target }
}
`;
  fs.mkdirSync(updateDir, { recursive: true });
  fs.writeFileSync(scriptPath, script.trimStart(), "utf8");
  return scriptPath;
}

function launchPortableUpdater(scriptPath) {
  const child = childProcess.spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-WindowStyle",
    "Hidden",
    "-File",
    scriptPath
  ], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

async function installUpdate() {
  const update = await readUpdateManifest();
  if (compareVersions(update.version, appVersion) <= 0) {
    return {
      ok: true,
      updated: false,
      currentVersion: appVersion,
      latestVersion: update.version,
      message: "Already up to date"
    };
  }

  const targetExe = getPortableExecutableFile();
  if (!targetExe) {
    throw new Error("Portable executable path is unavailable");
  }

  const updateDir = path.join(getStateDir(), "updates");
  const downloadedExe = path.join(updateDir, `PDN Game UA ${update.version}.exe`);
  await downloadFileWithSha256(update.url, downloadedExe, update.sha256);
  const scriptPath = writePortableUpdaterScript(targetExe, downloadedExe, update.version);
  launchPortableUpdater(scriptPath);

  setTimeout(() => process.exit(0), 1200);
  return {
    ok: true,
    updated: true,
    currentVersion: appVersion,
    latestVersion: update.version,
    restarting: true,
    message: "Update downloaded and verified. Restarting PDN Game UA."
  };
}

function buildSteamOpenIdUrl(req, loginId = "") {
  const baseUrl = buildBaseUrl(req);
  const returnTo = new URL(`${baseUrl}/api/auth/steam/callback`);
  if (loginId) returnTo.searchParams.set("login", loginId);
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo.toString(),
    "openid.realm": `${baseUrl}/`,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select"
  });
  return `https://steamcommunity.com/openid/login?${params.toString()}`;
}

async function verifySteamOpenId(requestUrl) {
  const params = new URLSearchParams();
  requestUrl.searchParams.forEach((value, key) => {
    if (key.startsWith("openid.")) params.set(key, value);
  });
  params.set("openid.mode", "check_authentication");
  const response = await httpsText("https://steamcommunity.com/openid/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(params.toString())
    }
  }, params.toString());
  if (!response.body.includes("is_valid:true")) throw new Error("Steam OpenID response is invalid");

  const claimedId = requestUrl.searchParams.get("openid.claimed_id") || "";
  const match = claimedId.match(/\/openid\/id\/(\d+)$/);
  if (!match) throw new Error("SteamID was not returned");
  return match[1];
}

function createSteamLoginRequest(req) {
  const loginId = crypto.randomBytes(18).toString("hex");
  const authUrl = buildSteamOpenIdUrl(req, loginId);
  pendingSteamLogins.set(loginId, {
    status: "pending",
    createdAt: Date.now()
  });
  return {
    loginId,
    authUrl,
    steamClientUrl: `steam://openurl/${authUrl}`
  };
}

function cleanupSteamLogins() {
  const now = Date.now();
  pendingSteamLogins.forEach((login, loginId) => {
    if (now - login.createdAt > 10 * 60 * 1000) pendingSteamLogins.delete(loginId);
  });
}

async function fetchSteamProfile(steamId) {
  const key = process.env.STEAM_WEB_API_KEY;
  if (key) {
    const apiUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(key)}&steamids=${encodeURIComponent(steamId)}`;
    const response = await httpsText(apiUrl);
    const data = JSON.parse(response.body);
    const player = data?.response?.players?.[0];
    if (player) {
      return {
        steamId,
        steamName: player.personaname || `Steam ${steamId.slice(-6)}`,
        displayName: player.personaname || `Steam ${steamId.slice(-6)}`,
        avatar: player.avatarfull || player.avatarmedium || player.avatar || ""
      };
    }
  }

  try {
    const response = await httpsText(`https://steamcommunity.com/profiles/${encodeURIComponent(steamId)}/?xml=1`);
    const name = response.body.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/)?.[1];
    const avatar = response.body.match(/<avatarFull><!\[CDATA\[(.*?)\]\]><\/avatarFull>/)?.[1];
    return {
      steamId,
      steamName: name || `Steam ${steamId.slice(-6)}`,
      displayName: name || `Steam ${steamId.slice(-6)}`,
      avatar: avatar || ""
    };
  } catch {
    return {
      steamId,
      steamName: `Steam ${steamId.slice(-6)}`,
      displayName: `Steam ${steamId.slice(-6)}`,
      avatar: ""
    };
  }
}

function steamLinkedPage() {
  return `<!doctype html>
<html lang="uk">
  <head><meta charset="utf-8"><meta http-equiv="refresh" content="1;url=/?steam=linked"><title>PDN Game UA</title></head>
  <body style="margin:0;background:#080b0d;color:#f4f8f7;font-family:Segoe UI,sans-serif;display:grid;place-items:center;min-height:100vh">
    <main style="text-align:center">
      <h1>Steam linked</h1>
      <p>Returning to PDN Game UA...</p>
    </main>
  </body>
</html>`;
}

function readRequestBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function readCString(buffer, offset) {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) end += 1;
  return {
    value: buffer.toString("utf8", offset, end),
    offset: end + 1
  };
}

function parseA2sInfo(buffer) {
  if (buffer.length < 6 || buffer.readInt32LE(0) !== -1 || buffer[4] !== 0x49) {
    return {};
  }

  let offset = 6;
  const name = readCString(buffer, offset);
  offset = name.offset;
  const map = readCString(buffer, offset);
  offset = map.offset;
  const folder = readCString(buffer, offset);
  offset = folder.offset;
  const game = readCString(buffer, offset);
  offset = game.offset + 2;

  return {
    name: name.value,
    map: map.value,
    folder: folder.value,
    game: game.value,
    players: buffer[offset] ?? 0,
    maxPlayers: buffer[offset + 1] ?? 0
  };
}

function buildA2sPacket(challenge) {
  const query = Buffer.from("ffffffff54536f7572636520456e67696e6520517565727900", "hex");
  if (typeof challenge !== "number") return query;
  const suffix = Buffer.alloc(4);
  suffix.writeInt32LE(challenge, 0);
  return Buffer.concat([query, suffix]);
}

function queryA2s(server, timeoutMs = 1600) {
  const address = server.publicAddress;
  const port = server.a2sPort;
  if (!address || !port) return Promise.resolve({ online: Boolean(server.online) });

  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const startedAt = Date.now();
    let resolved = false;

    const finish = (payload) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      socket.close();
      resolve(payload);
    };

    const timer = setTimeout(() => {
      finish({
        id: server.id,
        online: false,
        players: 0,
        maxPlayers: server.maxPlayers,
        ping: null,
        error: "timeout"
      });
    }, timeoutMs);

    socket.on("message", (message) => {
      if (message.length >= 9 && message.readInt32LE(0) === -1 && message[4] === 0x41) {
        const challenge = message.readInt32LE(5);
        socket.send(buildA2sPacket(challenge), port, address);
        return;
      }

      const info = parseA2sInfo(message);
      finish({
        id: server.id,
        online: true,
        players: info.players ?? server.players,
        maxPlayers: info.maxPlayers || server.maxPlayers,
        map: info.map || server.map,
        ping: Date.now() - startedAt,
        name: info.name || server.name
      });
    });

    socket.on("error", (error) => {
      finish({
        id: server.id,
        online: false,
        players: 0,
        maxPlayers: server.maxPlayers,
        ping: null,
        error: error.code || error.message
      });
    });

    socket.send(buildA2sPacket(), port, address);
  });
}

async function getLiveStatus() {
  const data = readJson("data/app-data.json");
  const statuses = await Promise.all((data.servers || []).map((server) => queryA2s(server)));
  return {
    checkedAt: new Date().toISOString(),
    servers: statuses
  };
}

function serveFile(req, res) {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const safeUrl = url === "/" ? "/index.html" : url;
  const file = path.normalize(path.join(root, safeUrl));

  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      ...securityHeaders(),
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

function createPdnServer() {
  return http.createServer((req, res) => {
  const requestUrl = new URL(req.url, buildBaseUrl(req));
  const url = requestUrl.pathname;

  if (!isAllowedHost(req)) {
    sendJson(res, 403, { error: "Forbidden host" });
    return;
  }

  if (!validateCsrf(req)) {
    sendJson(res, 403, { error: "Invalid security token" });
    return;
  }

  if (req.method === "GET" && url === "/api/health") {
    sendJson(res, 200, {
      app: "PDN Game UA",
      version: appVersion,
      status: "ok",
      time: new Date().toISOString()
    });
    return;
  }

  if (req.method === "GET" && url === "/api/app/version") {
    sendJson(res, 200, {
      app: "PDN Game UA",
      version: appVersion,
      updateManifestUrl: getUpdateManifestUrl(),
      portableExecutable: Boolean(getPortableExecutableFile())
    });
    return;
  }

  if (req.method === "GET" && url === "/api/app/update/check") {
    getUpdateStatus()
      .then((status) => sendJson(res, status.ok ? 200 : 503, status))
      .catch((error) => sendJson(res, 503, {
        ok: false,
        currentVersion: appVersion,
        latestVersion: appVersion,
        updateAvailable: false,
        error: error.message
      }));
    return;
  }

  if (req.method === "POST" && url === "/api/app/update/install") {
    installUpdate()
      .then((status) => sendJson(res, 200, status))
      .catch((error) => sendJson(res, 500, {
        ok: false,
        currentVersion: appVersion,
        error: error.message
      }));
    return;
  }

  if (req.method === "GET" && url === "/api/security/csrf") {
    const token = createCsrfToken();
    sendJson(res, 200, { csrfToken: token }, {
      "Set-Cookie": setCsrfCookie(token)
    });
    return;
  }

  if (req.method === "GET" && url === "/api/config") {
    try {
      sendJson(res, 200, readJson("data/app-data.json"));
    } catch (error) {
      sendJson(res, 500, { error: "Cannot read app data" });
    }
    return;
  }

  if (req.method === "GET" && url === "/api/profile") {
    const session = getSession(req);
    sendJson(res, 200, {
      authenticated: Boolean(session),
      profile: publicProfile(session)
    });
    return;
  }

  if (req.method === "GET" && url === "/api/auth/steam") {
    redirect(res, buildSteamOpenIdUrl(req));
    return;
  }

  if (req.method === "GET" && url === "/api/auth/steam/start") {
    cleanupSteamLogins();
    sendJson(res, 200, createSteamLoginRequest(req));
    return;
  }

  if (req.method === "GET" && url === "/api/auth/steam/status") {
    cleanupSteamLogins();
    const loginId = requestUrl.searchParams.get("login") || "";
    const login = pendingSteamLogins.get(loginId);
    if (!login) {
      sendJson(res, 404, { ok: false, status: "expired" });
      return;
    }

    if (login.status === "complete" && login.profile) {
      pendingSteamLogins.delete(loginId);
      const session = createSession(login.profile);
      sendJson(res, 200, {
        ok: true,
        status: "complete",
        profile: publicProfile(session.profile)
      }, {
        "Set-Cookie": setSessionCookie(session.token)
      });
      return;
    }

    if (login.status === "error") {
      pendingSteamLogins.delete(loginId);
      sendJson(res, 400, { ok: false, status: "error", error: login.error || "Steam auth failed" });
      return;
    }

    sendJson(res, 202, { ok: true, status: "pending" });
    return;
  }

  if (req.method === "GET" && url === "/api/auth/steam/callback") {
    const loginId = requestUrl.searchParams.get("login") || "";
    verifySteamOpenId(requestUrl)
      .then(fetchSteamProfile)
      .then((profile) => {
        if (loginId && pendingSteamLogins.has(loginId)) {
          pendingSteamLogins.set(loginId, {
            status: "complete",
            profile,
            createdAt: Date.now()
          });
          sendHtml(res, 200, steamLinkedPage());
          return;
        }
        const session = createSession(profile);
        sendHtml(res, 200, steamLinkedPage(), {
          "Set-Cookie": setSessionCookie(session.token)
        });
      })
      .catch((error) => {
        if (loginId && pendingSteamLogins.has(loginId)) {
          pendingSteamLogins.set(loginId, {
            status: "error",
            error: error.message,
            createdAt: Date.now()
          });
        }
        sendHtml(res, 401, `<!doctype html><meta charset="utf-8"><body>Steam auth failed: ${error.message}</body>`);
      });
    return;
  }

  if (req.method === "GET" && url === "/api/status") {
    getLiveStatus()
      .then((status) => sendJson(res, 200, status))
      .catch(() => sendJson(res, 500, { error: "Cannot read server status" }));
    return;
  }

  if (req.method === "GET" && url === "/api/admin/status") {
    const admin = getAdminSession(req);
    sendJson(res, 200, {
      configured: isAdminConfigured(),
      authenticated: Boolean(admin),
      adminName: admin?.name || ""
    });
    return;
  }

  if (req.method === "POST" && url === "/api/admin/login") {
    if (!isAdminConfigured()) {
      appendAdminAudit("admin-login-disabled", { ip: getClientKey(req) });
      sendJson(res, 503, { ok: false, error: "Admin password is not configured" });
      return;
    }

    if (isAdminRateLimited(req)) {
      appendAdminAudit("admin-login-rate-limited", { ip: getClientKey(req) });
      sendJson(res, 429, { ok: false, error: "Too many admin login attempts" });
      return;
    }

    readRequestBody(req, 2048)
      .then((body) => {
        const request = body ? JSON.parse(body) : {};
        const name = String(request.name || "").trim();
        const password = String(request.password || "");

        if (!verifyAdminCredentials(name, password)) {
          recordAdminLoginFailure(req);
          appendAdminAudit("admin-login-failed", { ip: getClientKey(req), name });
          sendJson(res, 401, { ok: false, error: "Invalid admin credentials" });
          return;
        }

        clearAdminLoginFailures(req);
        const token = createAdminSession(name);
        appendAdminAudit("admin-login-success", { ip: getClientKey(req), name });
        sendJson(res, 200, { ok: true, adminName: name }, {
          "Set-Cookie": setAdminCookie(token)
        });
      })
      .catch(() => sendJson(res, 400, { ok: false, error: "Invalid admin login request" }));
    return;
  }

  if (req.method === "POST" && url === "/api/admin/logout") {
    const admin = getAdminSession(req);
    if (admin) appendAdminAudit("admin-logout", { ip: getClientKey(req), name: admin.name });
    sendJson(res, 200, { ok: true }, {
      "Set-Cookie": clearAdminCookie()
    });
    return;
  }

  if (req.method === "GET" && url === "/api/auth/steam-demo") {
    const session = createSession({
      steamId: "76561198000000000",
      steamName: "PaDeNa Player",
      displayName: "PaDeNa Player",
      avatar: ""
    });
    sendJson(res, 200, {
      ok: true,
      provider: "steam-demo",
      ...publicProfile(session.profile)
    }, {
      "Set-Cookie": setSessionCookie(session.token)
    });
    return;
  }

  if (req.method === "POST" && url === "/api/profile/nickname") {
    const profile = getSession(req);
    if (!profile) {
      sendJson(res, 401, { ok: false, error: "Steam authentication required" });
      return;
    }

    readRequestBody(req)
      .then((body) => {
        const request = body ? JSON.parse(body) : {};
        const nickname = sanitizeNickname(request.nickname);
        if (!nickname) {
          sendJson(res, 400, { ok: false, error: "Nickname is required" });
          return;
        }

        if (nickname === profile.displayName) {
          sendJson(res, 200, { ok: true, status: "unchanged", profile: publicProfile(profile) });
          return;
        }

        if (!profile.nicknameChanged) {
          profile.displayName = nickname;
          profile.nicknameChanged = true;
          profile.pendingNickname = "";
          profile.nicknameChangedAt = new Date().toISOString();
          profilesBySteamId.set(profile.steamId, profile);
          savePersistentState();
          sendJson(res, 200, { ok: true, status: "updated", profile: publicProfile(profile) });
          return;
        }

        profile.pendingNickname = nickname;
        nicknameRequests.push({
          steamId: profile.steamId,
          currentNickname: profile.displayName,
          requestedNickname: nickname,
          createdAt: new Date().toISOString()
        });
        profilesBySteamId.set(profile.steamId, profile);
        savePersistentState();
        sendJson(res, 202, { ok: true, status: "pending-admin-approval", profile: publicProfile(profile) });
      })
      .catch(() => sendJson(res, 400, { ok: false, error: "Invalid nickname request" }));
    return;
  }

  if (req.method === "POST" && url === "/api/profile/nickname-request") {
    const profile = getSession(req);
    if (!profile) {
      sendJson(res, 401, { ok: false, error: "Steam authentication required" });
      return;
    }

    readRequestBody(req)
      .then((body) => {
        const request = body ? JSON.parse(body) : {};
        const nickname = sanitizeNickname(request.requestedNickname || request.nickname);
        if (!nickname) {
          sendJson(res, 400, { ok: false, error: "Nickname is required" });
          return;
        }
        profile.pendingNickname = nickname;
        nicknameRequests.push({
          steamId: profile.steamId,
          currentNickname: profile.displayName,
          requestedNickname: nickname,
          createdAt: new Date().toISOString()
        });
        profilesBySteamId.set(profile.steamId, profile);
        savePersistentState();
        sendJson(res, 202, {
          ok: true,
          status: "pending-admin-approval",
          profile: publicProfile(profile)
        });
      })
      .catch(() => sendJson(res, 400, { ok: false, error: "Invalid nickname request" }));
    return;
  }

  if (req.method === "POST" && url.startsWith("/api/admin/restart/")) {
    const admin = getAdminSession(req);
    if (!admin) {
      appendAdminAudit("admin-restart-denied", { ip: getClientKey(req) });
      sendJson(res, 401, { ok: false, error: "Admin authentication required" });
      return;
    }

    const serverId = decodeURIComponent(url.split("/").pop());
    const data = readJson("data/app-data.json");
    const server = (data.servers || []).find((item) => item.id === serverId);
    if (!server) {
      appendAdminAudit("admin-restart-invalid-server", { ip: getClientKey(req), name: admin.name, serverId });
      sendJson(res, 404, { ok: false, error: "Server not found" });
      return;
    }

    restartServerViaRcon(server, admin, req)
      .then((result) => sendJson(res, 202, {
        ok: true,
        serverId,
        serverName: server.name,
        message: "Restart command sent to local RCON.",
        rconResponse: String(result.response || "").slice(0, 500)
      }))
      .catch((error) => {
        appendAdminAudit("admin-rcon-restart-failed", {
          ip: getClientKey(req),
          name: admin.name,
          serverId,
          serverName: server.name,
          error: error.message
        });
        sendJson(res, 503, {
          ok: false,
          serverId,
          serverName: server.name,
          error: error.message
        });
      });
    return;
  }

  serveFile(req, res);
});
}

function startServer(options = {}) {
  const host = options.host || process.env.PDN_HOST || "127.0.0.1";
  const port = Number(options.port ?? process.env.PDN_PORT ?? 4173);
  const server = createPdnServer();

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      console.log(`PDN Game UA running at http://${host}:${actualPort}/`);
      resolve({ server, host, port: actualPort, url: `http://${host}:${actualPort}/` });
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { startServer };
