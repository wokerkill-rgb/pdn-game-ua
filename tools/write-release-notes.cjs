const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageInfo = require("../package.json");

const version = process.env.PDN_RELEASE_VERSION || packageInfo.version;
const exeSha256 = String(process.env.EXE_SHA256 || "").toUpperCase();
const publicZipSha256 = String(process.env.PUBLIC_ZIP_SHA256 || "").toUpperCase();
const outputPath = path.resolve(root, process.argv[2] || "dist/release-notes.md");

const notes = `# PDN Game UA ${version}

Автоматичний реліз через GitHub Actions.

## Security

- Update manifest підписаний Ed25519.
- Portable exe перевіряється через SHA256 перед встановленням оновлення.
- Private update key зберігається тільки в GitHub Secret \`PDN_UPDATE_PRIVATE_KEY\`.

## SHA256

\`\`\`text
PDN Game UA ${version}.exe
${exeSha256 || "<generated-by-ci>"}

PDN_Game_UA_${version}_Public.zip
${publicZipSha256 || "<generated-by-ci>"}
\`\`\`

## Still not done

- Code signing certificate для Windows SmartScreen ще не підключений.
- NSIS installer буде наступним кроком.
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, notes);
console.log(`Wrote release notes: ${outputPath}`);

