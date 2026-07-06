const { app, BrowserWindow, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { startServer } = require("./server");

let backend;

app.setAppUserModelId("ua.padena.pdngameua");

function resolveUserDataDir() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  const exeDir = app.isPackaged ? path.dirname(process.execPath) : "";
  const preferredBase = portableDir || exeDir;

  if (preferredBase) {
    const portableData = path.join(preferredBase, "PDN_Game_UA_Data");
    try {
      fs.mkdirSync(portableData, { recursive: true });
      fs.accessSync(portableData, fs.constants.W_OK);
      return portableData;
    } catch {
      // Fall back to Electron userData when the app folder is not writable.
    }
  }

  return app.getPath("userData");
}

function isAppUrl(url) {
  if (!backend?.url) return false;
  try {
    return new URL(url).origin === new URL(backend.url).origin;
  } catch {
    return false;
  }
}

function isAllowedExternalUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "steam:") return true;
    if (parsed.protocol === "https:" && parsed.hostname === "steamcommunity.com") return true;
    return false;
  } catch {
    return false;
  }
}

function getShortcutTarget() {
  const portableExecutable = process.env.PORTABLE_EXECUTABLE_FILE;
  if (portableExecutable && fs.existsSync(portableExecutable)) return portableExecutable;
  return process.execPath;
}

function createDesktopShortcutIfNeeded() {
  if (process.platform !== "win32" || !app.isPackaged || process.env.PDN_DISABLE_DESKTOP_SHORTCUT === "1") return;

  try {
    const target = getShortcutTarget();
    const shortcutPath = path.join(app.getPath("desktop"), "PDN Game UA.lnk");
    const operation = fs.existsSync(shortcutPath) ? "replace" : "create";

    shell.writeShortcutLink(shortcutPath, operation, {
      target,
      cwd: path.dirname(target),
      icon: target,
      iconIndex: 0,
      description: "PDN Game UA community launcher",
      appUserModelId: "ua.padena.pdngameua"
    });
  } catch (error) {
    console.warn("PDN Game UA desktop shortcut was not created.", error.message);
  }
}

async function createWindow() {
  process.env.PDN_USER_DATA = resolveUserDataDir();
  createDesktopShortcutIfNeeded();
  backend = await startServer({ port: 0 });

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    title: "PDN Game UA",
    backgroundColor: "#080b0d",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "assets", "app.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged
    }
  });

  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || webContents.getURL();
    callback(permission === "media" && isAppUrl(requestingUrl));
  });

  win.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return permission === "media" && isAppUrl(requestingOrigin || webContents.getURL());
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (isAllowedExternalUrl(url)) shell.openExternal(url);
  });

  win.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  await win.loadURL(backend.url);
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (backend?.server) backend.server.close();
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
