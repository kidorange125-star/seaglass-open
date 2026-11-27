import sanitizeHtml from "sanitize-html";

// Notes are stored as HTML and written by me, the agent, and MCP clients.
// Everything is sanitized on the way in so a bad write can never run script.
const color = [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^hsla?\([\d\s.,%]+\)$/i, /^var\(--[\w-]+\)$/, /^[a-z]+$/i];

const options: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "h1", "h2", "h3", "strong", "b", "em", "i", "s", "u", "code", "pre", "mark", "sub", "sup",
    "blockquote", "ul", "ol", "li", "hr", "a", "span", "div", "label", "input", "img",
    "details", "summary", "table", "colgroup", "col", "thead", "tbody", "tr", "th", "td", "iframe",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "width", "height", "data-drawing"], // data-drawing: the strokes file of a handwritten drawing (handwriting/ink.ts)
    input: ["type", "checked", "disabled"],
    details: ["open", "data-heading"],
    td: ["colspan", "rowspan", "colwidth"],
    th: ["colspan", "rowspan", "colwidth"],
    col: ["style"],
    iframe: ["src", "width", "height", "allowfullscreen", "frameborder", "allow"],
    "*": ["data-*", "class", "style"],
  },
  allowedStyles: {
    "*": {
      color, "background-color": color,
      "text-align": [/^(left|right|center|justify)$/],
      width: [/^\d+(\.\d+)?(px|%)$/], "min-width": [/^\d+(\.\d+)?(px|%)$/],
    },
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["https", "data"] },
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  allowedIframeHostnames: ["www.youtube.com", "www.youtube-nocookie.com", "player.vimeo.com"],
  // Relative image URLs (our own /files/...) must survive.
  transformTags: {
    a: (tag, attribs) => ({ tagName: tag, attribs: { ...attribs, rel: "noopener noreferrer nofollow", target: "_blank" } }),
  },
};

export const cleanHtml = (html: string) => sanitizeHtml(html, options);

export const toText = (html: string) =>
  // a handwritten drawing counts as its transcript (its alt, "Handwriting: …"), so search and embeddings find what the user wrote
  sanitizeHtml(html.replace(/<img\b[^>]*\bdata-drawing="[^"]*"[^>]*>/gi, (tag) => { const a = /\balt="([^"]*)"/.exec(tag)?.[1] ?? ""; return a && a !== "Handwriting" ? `<p>${a}</p>` : ""; })
    .replace(/<\/(p|li|h[1-3]|div|blockquote|tr)>/g, "$&\n"), {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();

// Ids of pages mentioned via @ in a note (data-type="mention" with a note id).
export function extractMentions(html: string): string[] {
  const ids = new Set<string>();
  for (const m of html.matchAll(/<(?:span|div)[^>]*data-type="(?:mention|child-page)"[^>]*>/g)) {
    const id = /data-id="([0-9a-f-]{36})"/.exec(m[0])?.[1];
    if (id) ids.add(id);
  }
  return [...ids];
}
