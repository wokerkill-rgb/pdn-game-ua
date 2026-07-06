const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { canonicalUpdateManifest } = require("../lib/update-signing.cjs");

const root = path.resolve(__dirname, "..");
const manifestPath = path.resolve(root, process.argv[2] || "website/downloads/pdn-game-ua/update.json");
const privateKeyInput = process.env.PDN_UPDATE_PRIVATE_KEY || ".local-secrets/update-private.pem";
const keyId = process.env.PDN_UPDATE_KEY_ID || "pdn-game-ua-update-v1";

function readPrivateKeyPem(input) {
  if (input.includes("BEGIN PRIVATE KEY")) return input;

  const privateKeyPath = path.resolve(root, input);
  if (fs.existsSync(privateKeyPath)) return fs.readFileSync(privateKeyPath, "utf8");

  console.error(`Private key not found: ${privateKeyPath}`);
  console.error("Set PDN_UPDATE_PRIVATE_KEY to a PEM secret or to a local key path.");
  console.error("Run: npm run update:keys");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
delete manifest.signature;

const payload = Buffer.from(canonicalUpdateManifest(manifest), "utf8");
const privateKey = crypto.createPrivateKey(readPrivateKeyPem(privateKeyInput));
const signature = crypto.sign(null, payload, privateKey).toString("base64");

manifest.signature = {
  algorithm: "ed25519",
  keyId,
  value: signature
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(`${manifestPath}.sig`, `${signature}\n`);
console.log(`Signed update manifest: ${manifestPath}`);
console.log(`Wrote detached signature: ${manifestPath}.sig`);
