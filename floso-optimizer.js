// Floso v1.2 — local token optimizer.
// This is deliberately deterministic: no context leaves the browser.

const FLOSO_OPTIMIZER_PROFILES = {
  universal: { name: "Universal", structure: "structured" },
  chatgpt: { name: "ChatGPT", structure: "explicit" },
  claude: { name: "Claude", structure: "semantic" },
  gemini: { name: "Gemini", structure: "structured" },
};

function flosoEstimateTokens(text) {
  if (!text) return 0;
  // A provider-independent estimate. Exact counts require each model's tokenizer.
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const punctuation = (text.match(/[.,!?;:()[\]{}'"`]/g) || []).length;
  return Math.max(1, Math.ceil((text.length / 4 + words * 0.15 + punctuation * 0.15)));
}

function flosoNormalize(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function flosoCompressPhrases(text, level) {
  let out = text;
  const replacements = [
    [/\bin order to\b/gi, "to"],
    [/\bdue to the fact that\b/gi, "because"],
    [/\bat this point in time\b/gi, "now"],
    [/\bfor the purpose of\b/gi, "for"],
    [/\bin the event that\b/gi, "if"],
    [/\bwith regard to\b/gi, "about"],
    [/\bin relation to\b/gi, "about"],
    [/\ba large number of\b/gi, "many"],
    [/\ba number of\b/gi, "some"],
    [/\bhas the ability to\b/gi, "can"],
    [/\bis able to\b/gi, "can"],
    [/\bmake sure that\b/gi, "ensure"],
    [/\bplease make sure to\b/gi, "ensure"],
    [/\bit is important to note that\b/gi, "note:"],
    [/\bI would like you to\b/gi, ""],
    [/\bI want you to\b/gi, ""],
    [/\bI need you to\b/gi, ""],
    [/\bcould you please\b/gi, "please"],
    [/\bcan you please\b/gi, "please"],
  ];

  const count = level === "safe" ? 7 : level === "balanced" ? replacements.length : replacements.length;
  replacements.slice(0, count).forEach(([pattern, replacement]) => {
    out = out.replace(pattern, replacement);
  });

  if (level === "compact") {
    out = out.replace(/\bvery\s+/gi, "");
    out = out.replace(/\breally\s+/gi, "");
    out = out.replace(/\bjust\s+/gi, "");
    out = out.replace(/\bbasically\s+/gi, "");
  }

  return flosoNormalize(out);
}

function flosoDeduplicateLines(text) {
  const lines = text.split("\n");
  const seen = new Set();
  const result = [];
  for (const line of lines) {
    const key = line.trim().toLowerCase();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    result.push(line);
  }
  return result.join("\n");
}

function flosoStructure(text, profile) {
  if (profile.structure === "explicit") {
    return text.replace(/^(Task|Goal|Instructions?)\s*:\s*/gim, "$1: ");
  }
  if (profile.structure === "semantic") {
    return text
      .replace(/^(User|Human)\s*:/gim, "USER:")
      .replace(/^(Assistant|AI)\s*:/gim, "AI:");
  }
  return text;
}

function flosoOptimizeContext(text, options = {}) {
  const level = options.level || "balanced";
  const model = options.model || "universal";
  const profile = FLOSO_OPTIMIZER_PROFILES[model] || FLOSO_OPTIMIZER_PROFILES.universal;
  const original = String(text || "");

  if (!original.trim()) {
    return { original, optimized: "", originalTokens: 0, optimizedTokens: 0, savedPercent: 0, model: profile.name };
  }

  let optimized = flosoNormalize(original);
  optimized = flosoDeduplicateLines(optimized);
  optimized = flosoCompressPhrases(optimized, level);
  optimized = flosoStructure(optimized, profile);

  // Keep blank-line separation in safe/balanced modes; compact removes only
  // formatting that cannot change the actual words or punctuation.
  if (level === "compact") optimized = optimized.replace(/\n{2,}/g, "\n");

  const originalTokens = flosoEstimateTokens(original);
  const optimizedTokens = flosoEstimateTokens(optimized);
  const savedPercent = originalTokens
    ? Math.max(0, Math.round((1 - optimizedTokens / originalTokens) * 100))
    : 0;

  return { original, optimized, originalTokens, optimizedTokens, savedPercent, model: profile.name };
}

window.FlosoOptimizer = {
  estimateTokens: flosoEstimateTokens,
  optimize: flosoOptimizeContext,
};