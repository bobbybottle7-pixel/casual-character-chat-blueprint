const TIMEOUT_MS = 10000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 5;
const EXCERPT_CHARS = 2000;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

function isPrivateIPv4(host) {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return false;
  const [a, b] = parts.map(Number);
  if (parts.some((p) => Number(p) > 255)) return false;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  return false;
}

function isPrivateIPv6(host) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // unique local fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true; // link-local fe80::/10
  return false;
}

// Guards the URL itself. Note the limitation: a public hostname that
// resolves to a private address (DNS rebinding) is not caught here —
// this is a local dev CLI fetching URLs its own user typed, not a server
// accepting untrusted input, so literal-address filtering is the
// proportionate control.
export function assertSafeUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Not a valid URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Refusing ${url.protocol} — only http and https are allowed.`);
  }

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error(`Refusing to fetch internal host "${url.hostname}".`);
  }
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) {
    throw new Error(`Refusing to fetch private/loopback address "${url.hostname}".`);
  }

  return url;
}

export function htmlToText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export function extractUrl(text) {
  const match = text.match(/https?:\/\/[^\s<>"'`]+/i);
  if (match) return match[0].replace(/[.,;:)\]]+$/, "");
  // Bare domain like "example.com/docs" — assume https.
  const bare = text.match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?)/i);
  return bare ? `https://${bare[1].replace(/[.,;:)\]]+$/, "")}` : null;
}

// Follows redirects manually so every hop is re-checked against the
// guard — `redirect: "follow"` would let hop 2 land on 169.254.169.254.
async function fetchGuarded(startUrl, fetchImpl) {
  let current = assertSafeUrl(startUrl).toString();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchImpl(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "agent-cli/1.0 (+https://github.com/anthropics/claude-code)" },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`Redirect ${res.status} with no Location header.`);
      current = assertSafeUrl(new URL(location, current).toString()).toString();
      continue;
    }

    return { res, finalUrl: current };
  }

  throw new Error(`Too many redirects (more than ${MAX_REDIRECTS}).`);
}

const skill = {
  name: "webFetch",
  description: "Fetches a public web page or API over http(s) and returns its readable text.",
  match(task) {
    // Any scheme, not just http(s) — so a "fetch file:///etc/passwd" gets
    // an explicit refusal from this skill rather than silently falling
    // through to the reasoning fallback.
    if (/\b[a-z][a-z0-9+.-]*:\/\//i.test(task)) return true;
    return /\b(fetch|download|browse|scrape|look ?up|read)\b[^.]*\b(url|link|site|website|web ?page|online|internet)\b/i.test(task);
  },
  needsConfirmation: false, // read-only GET of a public URL the user named
  assertSafeUrl,
  async run(input, ctx) {
    const fetchImpl = ctx?.fetch || globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      return { ok: false, output: "No fetch implementation available in this Node runtime." };
    }

    const scheme = input.match(/\b([a-z][a-z0-9+.-]*):\/\/\S+/i);
    if (scheme && !/^https?$/i.test(scheme[1])) {
      return { ok: false, retryable: false, output: `Refusing ${scheme[1]}:// — only http and https are allowed.` };
    }

    const target = extractUrl(input);
    if (!target) return { ok: false, retryable: false, output: "No URL found in that request." };

    let res, finalUrl;
    try {
      ({ res, finalUrl } = await fetchGuarded(target, fetchImpl));
    } catch (err) {
      const timedOut = err.name === "TimeoutError";
      const reason = timedOut ? `timed out after ${TIMEOUT_MS}ms` : err.message;
      // A guard refusal is a property of the URL itself — retrying can
      // only ever produce the same refusal, so don't burn a re-plan on it.
      return { ok: false, retryable: timedOut, output: `Could not fetch ${target}: ${reason}` };
    }

    if (!res.ok) {
      return { ok: false, output: `${finalUrl} returned HTTP ${res.status}.` };
    }

    const declaredLength = Number(res.headers.get("content-length") || 0);
    if (declaredLength > MAX_BYTES) {
      return { ok: false, retryable: false, output: `Response is ${declaredLength} bytes — over the ${MAX_BYTES}-byte cap.` };
    }

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (contentType && !/text\/|json|xml|javascript/.test(contentType)) {
      return { ok: false, retryable: false, output: `Skipping non-text content (${contentType}) at ${finalUrl}.` };
    }

    const body = (await res.text()).slice(0, MAX_BYTES);
    const text = /html/.test(contentType) ? htmlToText(body) : body.trim();
    const excerpt = text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}\n…(truncated)` : text;

    return { ok: true, output: `${finalUrl}\n\n${excerpt}` };
  },
};

export default skill;
