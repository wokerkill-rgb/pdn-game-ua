function sortForCanonicalJson(value) {
  if (Array.isArray(value)) return value.map(sortForCanonicalJson);
  if (!value || typeof value !== "object") return value;

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      if (key === "signature") return result;
      const item = value[key];
      if (typeof item !== "undefined") result[key] = sortForCanonicalJson(item);
      return result;
    }, {});
}

function canonicalUpdateManifest(manifest) {
  return JSON.stringify(sortForCanonicalJson(manifest));
}

module.exports = {
  canonicalUpdateManifest,
  sortForCanonicalJson
};

