const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageInfo = require("../package.json");

const version = process.env.PDN_RELEASE_VERSION || packageInfo.version;
const tag = process.env.GITHUB_REF_NAME || `v${version}`;
const repository = process.env.GITHUB_REPOSITORY || "wokerkill-rgb/pdn-game-ua";
const manifestPath = path.resolve(root, process.argv[2] || "website/downloads/pdn-game-ua/update.json");
const exePath = path.resolve(root, process.argv[3] || `dist/PDN Game UA ${version}.exe`);

if (!fs.existsSync(exePath)) {
  console.error(`Release exe not found: ${exePath}`);
  process.exit(1);
}

if (/^v\d+\.\d+\.\d+/.test(tag) && tag !== `v${version}`) {
  console.error(`Git tag (${tag}) does not match package.json version (${version}).`);
  process.exit(1);
}

const exe = fs.readFileSync(exePath);
const sha256 = crypto.createHash("sha256").update(exe).digest("hex");
const size = fs.statSync(exePath).size;
const encodedExeName = encodeURIComponent(path.basename(exePath)).replace(/%20/g, "%20");

const manifest = {
  appId: "ua.padena.pdngameua",
  version,
  releaseDate: new Date().toISOString().slice(0, 10),
  notes: {
    uk: "Автоматичний реліз PDN Game UA через GitHub Actions. Manifest підписаний Ed25519, файл перевіряється SHA256.",
    en: "Automated PDN Game UA release through GitHub Actions. The manifest is signed with Ed25519 and the file is verified with SHA256."
  },
  files: {
    winPortable: {
      url: `https://github.com/${repository}/releases/download/${tag}/${encodedExeName}`,
      sha256,
      size
    }
  }
};

fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Prepared update manifest: ${manifestPath}`);
console.log(`Version: ${version}`);
console.log(`SHA256: ${sha256.toUpperCase()}`);
console.log(`Size: ${size}`);
