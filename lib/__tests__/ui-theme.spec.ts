import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import postcss from "postcss";
import { DEFAULT_UI_THEME, normalizeUiTheme, readUiTheme, UI_THEME_BOOTSTRAP } from "../ui-theme";

describe("persisted UI theme", () => {
  it.each(["original", "claro"])("restores %s before paint", (theme) => {
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    runInNewContext(UI_THEME_BOOTSTRAP, { document, localStorage: { getItem: () => theme } });
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(readUiTheme({ getItem: () => theme })).toBe(theme);
  });
  it.each(["obsidiana", "grafito", "jade"])("restores Original for the removed %s palette", (theme) => {
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    runInNewContext(UI_THEME_BOOTSTRAP, { document, localStorage: { getItem: () => theme } });
    expect(document.documentElement.dataset.theme).toBe("original");
    expect(normalizeUiTheme(theme)).toBe("original");
    expect(readUiTheme({ getItem: () => theme })).toBe("original");
  });
  it.each([null, "", "dark", "<script>", {}, 5])("rejects unknown stored values %j", (value) => {
    expect(normalizeUiTheme(value)).toBe(DEFAULT_UI_THEME);
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    runInNewContext(UI_THEME_BOOTSTRAP, { document, localStorage: { getItem: () => value } });
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_UI_THEME);
  });
  it("renders even when browser storage throws", () => {
    const storage = { getItem: () => { throw new Error("blocked"); } };
    expect(readUiTheme(storage)).toBe(DEFAULT_UI_THEME);
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    expect(() => runInNewContext(UI_THEME_BOOTSTRAP, { document, localStorage: storage })).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_UI_THEME);
  });
});

function luminance(hex: string) {
  const rgb = hex.slice(1).match(/../g)!.map(channel => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const [bright, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (bright + 0.05) / (dark + 0.05);
}

describe("ERP palette legibility", () => {
  const css = postcss.parse(readFileSync("app/themes.css", "utf8"));
  const base: Record<string, string> = {};
  css.nodes.filter(node => node.type === "rule" && node.selector === ':root[data-theme="claro"]').forEach(node => {
    if (node.type === "rule") node.walkDecls(d => { base[d.prop] = d.value; });
  });
  for (const theme of ["claro"]) {
    const palette = { ...base };
    css.nodes.filter(node => node.type === "rule" && node.selector === `:root[data-theme="${theme}"]`).forEach(node => {
      if (node.type === "rule") node.walkDecls(d => { palette[d.prop] = d.value; });
    });
    it(`${theme}: panel labels and states meet AA for small text`, () => {
      for (const surface of ["--card-section", "--card-bg", "--card-raised", "--card-input", "--card-popover"]) {
        for (const text of ["--card-text", "--card-muted", "--card-accent"]) {
          expect(contrast(palette[text], palette[surface]), `${theme} ${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      for (const state of ["ok", "warn", "error"]) {
        expect(contrast(palette[`--card-${state}`], palette[`--card-${state}-bg`]), `${theme} ${state}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${theme}: input boundaries and focus indicators remain visible`, () => {
      expect(contrast(palette["--card-border"], palette["--card-input"])).toBeGreaterThanOrEqual(3);
      expect(contrast(palette["--card-accent"], palette["--card-input"])).toBeGreaterThanOrEqual(3);
    });
  }
  it("Claro includes a light canvas and navigation, not only light cards", () => {
    expect(base["color-scheme"]).toBe("light");
    expect(base["--background"]).toBe("#f3f6fa");
    expect(base["--shell"]).toBe("#ffffff");
    expect(base["--foreground"]).toBe("var(--card-text)");
    const page: Record<string, string> = {};
    css.walkRules(rule => {
      if (rule.selector === ':root[data-theme="claro"] body') rule.walkDecls(decl => { page[decl.prop] = decl.value; });
    });
    expect(page.background).toBe("var(--background)");
    expect(page.color).toBe("var(--foreground)");
    expect(contrast(base["--card-text"], base["--background"])).toBeGreaterThanOrEqual(4.5);
  });
  it("lights the whole interactive card on hover in Original and keeps Claro scoped", () => {
    const darkHover: string[] = [];
    css.walkRules(rule => {
      if (!rule.selector.includes(":hover")) return;
      if (!/(erp-interactive-card|erp-kpi|kpi-hover)/.test(rule.selector)) return;
      rule.walkDecls("background-color", decl => {
        if (!rule.selector.includes('data-theme="claro"')) darkHover.push(decl.value);
      });
    });
    expect(darkHover.some(value => value.includes("color-mix("))).toBe(true);
  });
  it("retains the original compact Costeo surfaces and geometry", () => {
    const costeo = postcss.parse(readFileSync("app/(internal)/projects/[id]/costeo-checklist.module.css", "utf8"));
    const declarations = (selector: string) => {
      const result: Record<string, string> = {};
      costeo.walkRules(rule => {
        if (rule.selector === selector && rule.parent?.type === "root") rule.walkDecls(decl => { result[decl.prop] = decl.value; });
      });
      return result;
    };
    expect(declarations(".panel")).toMatchObject({ background: "var(--panel)", color: "var(--foreground)", padding: "12px", gap: "10px" });
    expect(declarations(".row")).toMatchObject({ background: "var(--panel-2)", padding: "7px 10px", "border-left": "2px solid var(--card-interaction-accent)" });
    expect(declarations(".row:hover, .row:focus-within")["background"]).toContain("color-mix(");
    expect(declarations(".row:hover, .row:focus-within")["box-shadow"]).toContain("0 0 28px");
  });
  it("keeps the original blue page gradient and shell text independent of panel palettes", () => {
    const globals = postcss.parse(readFileSync("app/globals.css", "utf8"));
    const page: Record<string, string> = {};
    const tokens: Record<string, string> = {};
    globals.walkRules(rule => {
      if (rule.selector === "body") rule.walkDecls(decl => { page[decl.prop] = decl.value; });
      if (rule.selector === ":root") rule.walkDecls(decl => { tokens[decl.prop] = decl.value; });
    });
    expect(page.background).toContain("#0a1424");
    expect(page.background).toContain("#07101d");
    expect(page.background).toContain("#060d18");
    expect(page.background).not.toContain("--card-");
    expect(tokens["--foreground"]).toBe("#f5f8ff");
    expect(tokens["--primary"]).toBe("#5b8cff");
  });
});
