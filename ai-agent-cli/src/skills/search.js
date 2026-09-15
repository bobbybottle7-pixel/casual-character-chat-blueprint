import { htmlToText } from "./webFetch.js";

const MAX_RESULTS = 6;
const TIMEOUT_MS = 12000;
const DDG_ATTEMPTS = 3; // the keyless endpoint times out often enough to need retries

// Keyed providers are preferred when their env var is set; DuckDuckGo's
// keyless HTML endpoint is the fallback so search works with no signup.
const KEYED_PROVIDERS = [
  { name: "brave", env: "BRAVE_SEARCH_API_KEY" },
  { name: "tavily", env: "TAVILY_API_KEY" },
  { name: "serpapi", env: "SERPAPI_API_KEY" },
];

export function activeProvider(env = process.env) {
  return KEYED_PROVIDERS.find((p) => env[p.env])?.name ?? "duckduckgo";
}

export function extractQuery(input) {
  return input
    .replace(/^\s*(please\s+)?(do\s+a\s+)?(web\s+)?(search|google|look\s?up)\b\s*/i, "")
    .replace(/^\s*(for|up)\b\s*/i, "")
    .replace(/\b(on|via|using)\s+(the\s+)?(web|internet|google)\b\s*$/i, "")
    .replace(/[?]+\s*$/, "")
    .trim();
}

// DuckDuckGo wraps every href as //duckduckgo.com/l/?uddg=<encoded real url>
function unwrapDdgUrl(href) {
  const match = href.match(/[?&]uddg=([^&]+)/);
  if (!match) return href.startsWith("//") ? `https:${href}` : href;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function parseDuckDuckGo(html) {
  const results = [];
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const snippets = [];
  let s;
  while ((s = snippetRe.exec(html)) !== null) snippets.push(htmlToText(s[1]));

  let m;
  let i = 0;
  while ((m = linkRe.exec(html)) !== null && results.length < MAX_RESULTS) {
    const url = unwrapDdgUrl(m[1].replace(/&amp;/g, "&"));
    if (!url) continue;
    results.push({ title: htmlToText(m[2]), url, snippet: snippets[i] ?? "" });
    i++;
  }
  return results;
}

async function searchDuckDuckGo(query, fetchImpl) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  let lastError;
  for (let attempt = 1; attempt <= DDG_ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) agent-cli/1.0" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseDuckDuckGo(await res.text());
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`DuckDuckGo did not respond after ${DDG_ATTEMPTS} attempts (${lastError?.name || lastError?.message}).`);
}

async function searchBrave(query, fetchImpl, env) {
  const res = await fetchImpl(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_RESULTS}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "application/json", "x-subscription-token": env.BRAVE_SEARCH_API_KEY },
  });
  if (!res.ok) throw new Error(`Brave Search returned HTTP ${res.status}`);
  const data = await res.json();
  return (data.web?.results || []).slice(0, MAX_RESULTS).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: htmlToText(r.description || ""),
  }));
}

async function searchTavily(query, fetchImpl, env) {
  const res = await fetchImpl("https://api.tavily.com/search", {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: env.TAVILY_API_KEY, query, max_results: MAX_RESULTS }),
  });
  if (!res.ok) throw new Error(`Tavily returned HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || []).slice(0, MAX_RESULTS).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content || "",
  }));
}

async function searchSerpApi(query, fetchImpl, env) {
  const res = await fetchImpl(
    `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&num=${MAX_RESULTS}&api_key=${encodeURIComponent(env.SERPAPI_API_KEY)}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) }
  );
  if (!res.ok) throw new Error(`SerpAPI returned HTTP ${res.status}`);
  const data = await res.json();
  return (data.organic_results || []).slice(0, MAX_RESULTS).map((r) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet || "",
  }));
}

const RUNNERS = {
  duckduckgo: searchDuckDuckGo,
  brave: searchBrave,
  tavily: searchTavily,
  serpapi: searchSerpApi,
};

const skill = {
  name: "search",
  description: "Searches the web and returns the top results with titles, URLs and snippets.",
  match(task) {
    // An explicit URL means the user already knows where to look — that's
    // webFetch's job, not a search.
    if (/https?:\/\//i.test(task)) return false;
    return /\b(search|google|look\s?up)\b/i.test(task);
  },
  needsConfirmation: false,
  activeProvider,
  async run(input, ctx) {
    const fetchImpl = ctx?.fetch || globalThis.fetch;
    const env = ctx?.env || process.env;
    const query = extractQuery(input);
    if (!query) return { ok: false, retryable: false, output: "No search query found in that request." };

    const provider = activeProvider(env);
    let results;
    try {
      results = await RUNNERS[provider](query, fetchImpl, env);
    } catch (err) {
      return { ok: false, output: `Search via ${provider} failed: ${err.message}` };
    }

    if (!results.length) return { ok: false, output: `No results for "${query}" (via ${provider}).` };

    const output = [
      `Top ${results.length} results for "${query}" (via ${provider}):`,
      ...results.map((r, i) => `  ${i + 1}. ${r.title}\n     ${r.url}${r.snippet ? `\n     ${r.snippet}` : ""}`),
    ].join("\n");

    // `data` leads with the URL on each line so chaining into webFetch
    // picks up the top hit (webFetch takes the first URL it finds), while
    // still carrying titles for a step that just saves the list.
    const data = results.map((r) => `${r.url} — ${r.title}`).join("\n");

    return { ok: true, output, data };
  },
};

export default skill;
