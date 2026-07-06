const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { canonicalUpdateManifest } = require("../lib/update-signing.cjs");

const root = path.resolve(__dirname, "..");
const manifestPath = path.resolve(root, process.argv[2] || "website/downloads/pdn-game-ua/update.json");
const publicKeyPath = path.resolve(root, process.argv[3] || "assets/update-public-key.pem");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const signature = manifest.signature || {};
const signatureValue = String(signature.value || "");

if (signature.algorithm !== "ed25519" || !signatureValue) {
  throw new Error("Manifest signature is missing or uses an unsupported algorithm");
}

const payload = Buffer.from(canonicalUpdateManifest(manifest), "utf8");
const publicKey = crypto.createPublicKey(fs.readFileSync(publicKeyPath, "utf8"));
const ok = crypto.verify(null, payload, publicKey, Buffer.from(signatureValue, "base64"));

if (!ok) throw new Error("Manifest signature verification failed");
console.log("Manifest signature ok.");

