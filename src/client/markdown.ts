import TurndownService from "turndown";
import { marked } from "marked";

const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
td.addRule("taskItem", {
  filter: (n) => n.nodeName === "LI" && (n as HTMLElement).getAttribute("data-type") === "taskItem",
  replacement: (content, n) => `- [${(n as HTMLElement).getAttribute("data-checked") === "true" ? "x" : " "}] ${content.trim().replace(/\n+/g, " ")}\n`,
});
td.addRule("label", { filter: ["label", "input"], replacement: () => "" });
td.addRule("callout", { filter: (n) => (n as HTMLElement).getAttribute?.("data-type") === "callout", replacement: (c, n) => `> ${(n as HTMLElement).getAttribute("data-emoji") ?? "💡"} ${c.trim().replace(/\n/g, "\n> ")}\n\n` });
td.addRule("math", { filter: (n) => !!(n as HTMLElement).getAttribute?.("data-latex"), replacement: (_c, n) => { const l = (n as HTMLElement).getAttribute("data-latex"); return (n as HTMLElement).getAttribute("data-type") === "block-math" ? `\n$$\n${l}\n$$\n` : `$${l}$`; } });
td.addRule("bookmark", { filter: (n) => (n as HTMLElement).getAttribute?.("data-type") === "bookmark", replacement: (_c, n) => { const e = n as HTMLElement; return `[${e.getAttribute("data-title") || e.getAttribute("data-url")}](${e.getAttribute("data-url")})\n\n`; } });
td.addRule("details", { filter: "details", replacement: (c) => `${c}\n` });

export const htmlToMarkdown = (html: string) => td.turndown(html);

// Markdown to the HTML shape the editor understands (marked's task lists become TipTap task lists).
export function markdownToHtml(md: string): string {
  const raw = marked.parse(md, { async: false }) as string;
  const doc = new DOMParser().parseFromString(raw, "text/html");
  doc.querySelectorAll("ul").forEach((ul) => {
    const items = [...ul.children].filter((c) => c.tagName === "LI");
    if (!items.length || !items.every((li) => li.querySelector(":scope > input[type=checkbox], :scope > p > input[type=checkbox]"))) return;
    ul.setAttribute("data-type", "taskList");
    items.forEach((li) => {
      const box = li.querySelector("input[type=checkbox]") as HTMLInputElement;
      const checked = box.hasAttribute("checked");
      box.remove();
      li.setAttribute("data-type", "taskItem"); li.setAttribute("data-checked", String(checked));
      const inner = li.innerHTML.trim();
      li.innerHTML = `<label><input type="checkbox"${checked ? " checked" : ""}><span></span></label><div>${inner.startsWith("<") ? inner : `<p>${inner}</p>`}</div>`;
    });
  });
  return doc.body.innerHTML;
}
