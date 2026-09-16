/**
 * Small markdown renderer.
 *
 * Everything is HTML-escaped before any markup is introduced, so model output
 * and imported card text can never inject nodes. Deliberately narrow: this
 * covers what chat replies actually use, not the CommonMark spec.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Only http(s) and mailto links survive, so `javascript:` URLs cannot render. */
function safeUrl(url) {
  return /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : '#';
}

function inline(text) {
  return text
    .replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) =>
      `<a href="${escapeHtml(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, '$1<em>$2</em>');
}

export function renderMarkdown(source) {
  const escaped = escapeHtml(source ?? '');
  const out = [];
  const lines = escaped.split('\n');

  let i = 0;
  let paragraph = [];
  let list = null; // { tag, items }

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    out.push(`<${list.tag}>${list.items.map((li) => `<li>${inline(li)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block — taken verbatim, no inline processing.
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      flushAll();
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      const lang = fence[1] ? ` class="language-${fence[1]}"` : '';
      out.push(`<pre><code${lang}>${body.join('\n')}</code></pre>`);
      continue;
    }

    if (!line.trim()) {
      flushAll();
      i += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = Math.min(heading[1].length + 1, 4);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*&gt;\s?/.test(line)) {
      flushAll();
      const body = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*&gt;\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${inline(body.join(' '))}</blockquote>`);
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push((bullet || numbered)[1]);
      i += 1;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      flushAll();
      out.push('<hr>');
      i += 1;
      continue;
    }

    flushList();
    paragraph.push(line.trim());
    i += 1;
  }

  flushAll();
  return out.join('');
}
