// Fetched content is untrusted even when the source build generated it.
// Parse in an inert template, then build new HTML nodes from a narrow Markdown
// vocabulary. Never attach parsed nodes or serialize them back into innerHTML.
const elements = new Set([
  "div", "section", "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "blockquote", "pre", "code", "strong", "em", "del",
  "br", "hr", "a", "img", "table", "thead", "tbody", "tr", "th", "td",
]);
const classes = new Set(["first-use-notice-list", "first-use-notice-item", "markdown-blockquote"]);

export function renderContentFragment(target: HTMLElement, html: string, documentObj: Document): void {
  const template = documentObj.createElement("template");
  template.innerHTML = html;
  const fragment = documentObj.createDocumentFragment();
  const safeUrl = (value: string | null): string | null => {
    if (!value?.trim()) return null;
    try {
      const url = new URL(value, documentObj.baseURI);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch { return null; }
  };
  const copy = (source: Node, parent: Node, depth: number): void => {
    if (depth > 64) return;
    if (source.nodeType === 3) {
      parent.appendChild(documentObj.createTextNode(source.textContent || ""));
      return;
    }
    if (source.nodeType !== 1) return;
    const element = source as Element;
    const tag = element.localName;
    if (element.namespaceURI !== "http://www.w3.org/1999/xhtml" || !elements.has(tag)) return;
    const node = documentObj.createElement(tag);
    const classNames = (element.getAttribute("class") || "").split(/\s+/).filter(name => classes.has(name));
    if (classNames.length) node.className = classNames.join(" ");
    const title = element.getAttribute("title");
    if (title) node.title = title;
    if (tag === "a") {
      const href = safeUrl(element.getAttribute("href"));
      if (href) node.setAttribute("href", href);
      if (element.getAttribute("target") === "_blank") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    } else if (tag === "img") {
      const src = safeUrl(element.getAttribute("src"));
      if (!src) return;
      node.setAttribute("src", src);
      node.setAttribute("alt", element.getAttribute("alt") || "");
      node.setAttribute("loading", "lazy");
    } else if (tag === "ol") {
      const start = element.getAttribute("start");
      if (start && /^-?\d{1,9}$/.test(start)) node.setAttribute("start", start);
    } else if (tag === "th" || tag === "td") {
      const align = element.getAttribute("align");
      if (align && ["left", "center", "right"].includes(align)) node.setAttribute("align", align);
    }
    for (const child of Array.from(source.childNodes)) copy(child, node, depth + 1);
    parent.appendChild(node);
  };
  for (const child of Array.from(template.content.childNodes)) copy(child, fragment, 0);
  target.replaceChildren(fragment);
}
