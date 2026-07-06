const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const privateKeyPath = path.join(root, ".local-secrets", "update-private.pem");
const publicKeyPath = path.join(root, "assets", "update-public-key.pem");

if (fs.existsSync(privateKeyPath) || fs.existsSync(publicKeyPath)) {
  console.error("Update signing keys already exist. Refusing to overwrite them.");
  console.error(`Private key: ${privateKeyPath}`);
  console.error(`Public key:  ${publicKeyPath}`);
  process.exit(1);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");

fs.mkdirSync(path.dirname(privateKeyPath), { recursive: true });
fs.mkdirSync(path.dirname(publicKeyPath), { recursive: true });

fs.writeFileSync(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
fs.writeFileSync(publicKeyPath, publicKey.export({ type: "spki", format: "pem" }));

console.log("Generated PDN Game UA update signing keys.");
console.log(`Private key, keep secret: ${privateKeyPath}`);
console.log(`Public key, safe to publish: ${publicKeyPath}`);

