import "server-only";

import sanitizeHtml from "sanitize-html";
import { DomUtils, ElementType, parseDocument } from "htmlparser2";
import postcss, { type Declaration, type Root, type Rule } from "postcss";

const MAX_TEMPLATE_LENGTH = 128 * 1024;
const MAX_STYLES_LENGTH = 32 * 1024;
const MAX_CSS_NODE_LENGTH = 4096;
const TEMPLATE_SCOPE = "[data-company-template]";

const HTML_TAGS = [
  "address", "article", "aside", "blockquote", "br", "caption", "code", "dd", "div", "dl", "dt",
  "em", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr",
  "i", "img", "li", "main", "nav", "ol", "p", "pre", "section", "small", "span", "strong",
  "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
];

const NON_TEXT_TAGS = [
  "script", "style", "textarea", "option", "xmp", "iframe", "object", "embed", "svg", "math",
  "template", "noscript", "video", "audio", "picture",
];

const SAFE_CSS_VALUE = /^[a-z\d\s#.,%+\-/]+$/i;
const SAFE_SELECTOR_CHARACTERS = /^[a-z\d_\s.#*+~>,:[\]()="'-]+$/i;

const INLINE_PROPERTIES = [
  "align-items", "background-color", "border", "border-bottom", "border-bottom-color", "border-bottom-style",
  "border-bottom-width", "border-collapse", "border-color", "border-left", "border-left-color", "border-left-style",
  "border-left-width", "border-radius", "border-right", "border-right-color", "border-right-style", "border-right-width",
  "border-spacing", "border-style", "border-top", "border-top-color", "border-top-style", "border-top-width",
  "border-width", "box-shadow", "box-sizing", "color", "display", "flex", "flex-basis", "flex-direction",
  "flex-grow", "flex-shrink", "flex-wrap", "font-family", "font-size", "font-style", "font-weight", "gap",
  "grid-template-columns", "grid-template-rows", "height", "justify-content", "letter-spacing", "line-height",
  "list-style-type", "margin", "margin-bottom", "margin-left", "margin-right", "margin-top", "max-height",
  "max-width", "min-height", "min-width", "object-fit", "overflow", "overflow-wrap", "padding", "padding-bottom",
  "padding-left", "padding-right", "padding-top", "page-break-after", "page-break-before", "page-break-inside",
  "position", "text-align", "text-decoration", "text-transform", "vertical-align", "white-space", "width", "word-break",
];

const PAGE_PROPERTIES = new Set([
  "margin", "margin-bottom", "margin-left", "margin-right", "margin-top", "size",
]);

const SAFE_IDENTIFIER_VALUES: Record<string, RegExp> = {
  "align-items": /^(?:normal|stretch|center|start|end|flex-start|flex-end|baseline)$/i,
  "border-collapse": /^(?:collapse|separate)$/i,
  "box-sizing": /^(?:border-box|content-box)$/i,
  display: /^(?:block|inline|inline-block|flex|inline-flex|grid|inline-grid|table|table-row|table-cell|table-header-group|table-footer-group|none)$/i,
  "flex-direction": /^(?:row|row-reverse|column|column-reverse)$/i,
  "flex-wrap": /^(?:nowrap|wrap|wrap-reverse)$/i,
  "font-style": /^(?:normal|italic|oblique)$/i,
  "font-weight": /^(?:normal|bold|bolder|lighter|[1-9]00)$/i,
  "justify-content": /^(?:normal|start|end|center|flex-start|flex-end|space-between|space-around|space-evenly|stretch)$/i,
  "list-style-type": /^(?:none|disc|circle|square|decimal|lower-alpha|upper-alpha|lower-roman|upper-roman)$/i,
  "object-fit": /^(?:fill|contain|cover|none|scale-down)$/i,
  overflow: /^(?:visible|hidden|clip|scroll|auto)$/i,
  "overflow-wrap": /^(?:normal|break-word|anywhere)$/i,
  position: /^(?:static|relative)$/i,
  "text-align": /^(?:left|right|center|justify|start|end)$/i,
  "text-decoration": /^(?:none|underline|overline|line-through|underline overline)$/i,
  "text-transform": /^(?:none|capitalize|uppercase|lowercase)$/i,
  "vertical-align": /^(?:baseline|sub|super|top|text-top|middle|bottom|text-bottom)$/i,
  "white-space": /^(?:normal|nowrap|pre|pre-wrap|pre-line|break-spaces)$/i,
  "word-break": /^(?:normal|break-all|keep-all|break-word)$/i,
  "page-break-after": /^(?:auto|always|avoid|left|right|recto|verso)$/i,
  "page-break-before": /^(?:auto|always|avoid|left|right|recto|verso)$/i,
  "page-break-inside": /^(?:auto|avoid)$/i,
};

const ALLOWED_INLINE_STYLES: NonNullable<Parameters<typeof sanitizeHtml>[1]>["allowedStyles"] = {
  "*": Object.fromEntries(INLINE_PROPERTIES.map((property) => [property, [SAFE_CSS_VALUE]])),
};

function validCssValue(property: string, value: string, forPage = false): boolean {
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_CSS_NODE_LENGTH || !SAFE_CSS_VALUE.test(normalized)) return false;
  if (forPage && !PAGE_PROPERTIES.has(property)) return false;

  if (property === "size") {
    return /^(?:A4|A5|letter|legal|portrait|landscape|A4\s+(?:portrait|landscape)|A5\s+(?:portrait|landscape)|letter\s+(?:portrait|landscape)|legal\s+(?:portrait|landscape))$/i.test(normalized);
  }

  const identifiers = SAFE_IDENTIFIER_VALUES[property];
  if (identifiers) return identifiers.test(normalized);

  // CSS functions, escapes, strings, URL schemes, custom properties and delimiters
  // are intentionally excluded by SAFE_CSS_VALUE. Remaining values are inert
  // dimensions, colors, or space/comma-separated CSS keywords.
  return true;
}

function splitSelectorList(selector: string): string[] | null {
  if (selector.length > MAX_CSS_NODE_LENGTH || !SAFE_SELECTOR_CHARACTERS.test(selector)) return null;
  const parts: string[] = [];
  let start = 0;
  let parens = 0;
  let brackets = 0;
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "(") {
      parens += 1;
    } else if (character === ")") {
      parens -= 1;
      if (parens < 0) return null;
    } else if (character === "[") {
      brackets += 1;
    } else if (character === "]") {
      brackets -= 1;
      if (brackets < 0) return null;
    } else if (character === "," && parens === 0 && brackets === 0) {
      const part = selector.slice(start, index).trim();
      if (!part) return null;
      parts.push(part);
      start = index + 1;
    }
  }

  const last = selector.slice(start).trim();
  if (quote || parens !== 0 || brackets !== 0 || !last) return null;
  parts.push(last);
  return parts;
}

function scopeSelector(selector: string): string | null {
  const parts = splitSelectorList(selector);
  if (!parts) return null;

  return parts.map((part) => {
    if (part.startsWith(TEMPLATE_SCOPE)) {
      const suffix = part.slice(TEMPLATE_SCOPE.length);
      // Sanitization can run repeatedly on persisted HTML. Treat already-scoped
      // selectors as idempotent, but never let their leading combinator target
      // a sibling outside the document wrapper.
      if (/^\s*[+~]/.test(suffix)) return "";
      return part;
    }
    if (/^(?:html|body|:root)(?:\s|$)/i.test(part)) {
      return `${TEMPLATE_SCOPE}${part.replace(/^(?:html|body|:root)/i, "")}`;
    }
    return `${TEMPLATE_SCOPE} ${part}`;
  }).filter(Boolean).join(", ") || null;
}

function filterDeclarations(container: postcss.Container, forPage = false): Declaration[] {
  return (container.nodes ?? []).flatMap((node) => {
    if (node.type !== "decl") return [];
    const property = node.prop.toLowerCase();
    if (!INLINE_PROPERTIES.includes(property) && !(forPage && PAGE_PROPERTIES.has(property))) return [];
    if (!validCssValue(property, node.value, forPage)) return [];
    return [postcss.decl({ prop: property, value: node.value.trim() })];
  });
}

function sanitizedRule(rule: Rule): Rule | null {
  const selector = scopeSelector(rule.selector);
  if (!selector) return null;

  const declarations = filterDeclarations(rule);
  if (!declarations.length) return null;
  const result = postcss.rule({ selector });
  result.append(...declarations);
  return result;
}

function safeStylesheet(source: string): string {
  if (!source || source.length > MAX_STYLES_LENGTH) return "";

  let parsed: Root;
  try {
    // `map: false` is deliberate: untrusted sourceMappingURL comments must never
    // cause source-map files to be resolved or loaded from disk.
    parsed = postcss.parse(source, { map: false });
  } catch {
    return "";
  }

  const output = postcss.root();
  for (const node of parsed.nodes) {
    if (node.type === "rule") {
      const rule = sanitizedRule(node);
      if (rule) output.append(rule);
      continue;
    }
    if (node.type !== "atrule") continue;

    const name = node.name.toLowerCase();
    if (name === "page") {
      if (!/^\s*(?::(?:first|left|right))?\s*$/i.test(node.params)) continue;
      const declarations = filterDeclarations(node, true);
      if (declarations.length) {
        // Serialize @page as a true at-rule rather than a selector rule.
        const pageAtRule = postcss.atRule({ name: "page", params: node.params.trim() });
        pageAtRule.append(...declarations);
        output.append(pageAtRule);
      }
      continue;
    }
    if (name !== "media" || !/^(?:print|screen|all)$/i.test(node.params.trim()) || !node.nodes) continue;

    const media = postcss.atRule({ name: "media", params: node.params.trim().toLowerCase() });
    for (const child of node.nodes) {
      if (child.type !== "rule") continue;
      const rule = sanitizedRule(child);
      if (rule) media.append(rule);
    }
    if (media.nodes?.length) output.append(media);
  }

  // PostCSS stringifies the new AST, so comments, original formatting,
  // source-map annotations, unknown at-rules and discarded declarations vanish.
  return output.toString();
}

const HTML_SANITIZER_OPTIONS: Parameters<typeof sanitizeHtml>[1] = {
  allowedTags: HTML_TAGS,
  allowedAttributes: {
    "*": ["class", "title", "style"],
    img: ["src", "alt", "title", "width", "height", "style"],
  },
  allowedStyles: ALLOWED_INLINE_STYLES,
  parseStyleAttributes: true,
  allowedSchemes: [],
  allowProtocolRelative: false,
  nonTextTags: NON_TEXT_TAGS,
  nestingLimit: 32,
  transformTags: {
    img: (_tagName, attributes) => {
      const result = { ...attributes };
      // Templates may name only their own server-injected logo. Arbitrary HTTP,
      // data, protocol-relative and relative resource URLs are all removed.
      if (result.src !== "{{LOGO_URL}}") delete result.src;
      return { tagName: "img", attribs: result };
    },
  },
};

function collectStyles(template: string): string {
  const document = parseDocument(template, { decodeEntities: true, lowerCaseAttributeNames: true });
  const styles = DomUtils.findAll(
    (element) => (element.type === ElementType.Tag || element.type === ElementType.Style) && element.name.toLowerCase() === "style",
    document.children
  );
  const rawStyles = styles.map((element) => DomUtils.textContent(element)).join("\n");
  return safeStylesheet(rawStyles);
}

/** Sanitize a stored or generated invoice template before any preview or render. */
export function sanitizeTemplateHtml(template: string): string {
  if (typeof template !== "string" || template.length > MAX_TEMPLATE_LENGTH) return "";

  const stylesheet = collectStyles(template);
  let markup: string;
  try {
    markup = sanitizeHtml(template, HTML_SANITIZER_OPTIONS);
  } catch {
    return "";
  }

  return stylesheet ? `<style>${stylesheet}</style>${markup}` : markup;
}

export function isTemplateHtmlWithinLimit(template: unknown): template is string {
  return typeof template === "string" && template.length > 0 && template.length <= MAX_TEMPLATE_LENGTH;
}

export function substituteTemplateValues(
  sanitizedTemplate: string,
  values: Record<string, string>,
  itemsHtml: string,
  logoUrl: string
): string {
  const document = parseDocument(sanitizedTemplate, { decodeEntities: true, lowerCaseAttributeNames: true });
  const itemsSlot = `TEMPLATE_ITEMS_SLOT_${crypto.randomUUID().replaceAll("-", "")}_END`;
  const replaceTokens = (input: string, allowItems: boolean): string => input.replace(/\{\{[A-Z_]+\}\}/g, (token) => {
    if (token === "{{ITEMS_HTML}}") return allowItems ? itemsSlot : "";
    if (token === "{{LOGO_URL}}") return "";
    return Object.prototype.hasOwnProperty.call(values, token) ? values[token] : token;
  });

  const walk = (node: (typeof document.children)[number], insideStyle = false): void => {
    const isStyle = (node.type === ElementType.Tag || node.type === ElementType.Style) && node.name.toLowerCase() === "style";
    if (insideStyle || isStyle) return;

    if (node.type === ElementType.Text) {
      node.data = replaceTokens(node.data, true);
      return;
    }

    if (node.type === ElementType.Tag) {
      if (node.name.toLowerCase() === "img") {
        if (node.attribs.src === "{{LOGO_URL}}" && logoUrl) node.attribs.src = logoUrl;
        else delete node.attribs.src;
      }
      for (const [name, value] of Object.entries(node.attribs)) {
        if (name === "src" && node.name.toLowerCase() === "img") continue;
        node.attribs[name] = replaceTokens(value, false);
      }
    }

    if ("children" in node) {
      for (const child of node.children) walk(child, insideStyle || isStyle);
    }
  };

  for (const node of document.children) walk(node);
  const styleNodes = DomUtils.findAll(
    (element) => (element.type === ElementType.Tag || element.type === ElementType.Style) && element.name.toLowerCase() === "style",
    document.children
  );
  const styleMarkup = styleNodes.map((element) => DomUtils.getOuterHTML(element)).join("");
  for (const style of styleNodes) DomUtils.removeElement(style);

  const content = DomUtils.getOuterHTML(document.children);
  const renderedItems = content.replaceAll(itemsSlot, itemsHtml);
  return `${styleMarkup}<div data-company-template="true">${renderedItems}</div>`;
}
