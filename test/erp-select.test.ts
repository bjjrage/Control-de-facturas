import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Select } from "@/components/ui/select";
import { readFileSync } from "node:fs";

describe("ERP Radix Select contracts", () => {
  it.each([
    ["product", "product-1"], ["provider_id", "provider-1"], ["budget_item_id", "item-1"],
    ["labor_rate_id", "rate-1"], ["state", "PERDIDA"], ["mode", "FIXED"],
    ["classification", "NON_WORKABLE_OTHER"], ["reason", "ACCESS_BLOCKED"],
  ])("preserves exact FormData name %s and value %s without a native select", (name, value) => {
    const html = renderToStaticMarkup(createElement(Select, { name, defaultValue: value, "aria-label": name }, createElement("option", { value }, "Selected option")));
    expect(html).not.toContain("<select");
    expect(html).toContain(`name="${name}"`); expect(html).toContain(`value="${value}"`);
    expect(html).toContain('role="combobox"');
  });
  it("renders disabled trigger and disabled successful-control exclusion", () => {
    const html = renderToStaticMarkup(createElement(Select, { name: "disabled", disabled: true, defaultValue: "one" }, createElement("option", { value: "one" }, "One")));
    expect(html).toMatch(/<input[^>]+disabled=""/); expect(html).toMatch(/<button[^>]+disabled=""/);
  });
  it("retains browser required validation with an accessible focus target", () => {
    const html = renderToStaticMarkup(createElement(Select, { name: "required", required: true, defaultValue: "" }, createElement("option", { value: "" }, "Choose")));
    expect(html).toMatch(/<input[^>]+required=""/); expect(html).toContain('aria-required="true"');
  });
  it("migrates the required PREBID/RFQ/climate/personnel/weekly-plan surfaces", () => {
    for (const file of ["app/(internal)/licitaciones/[id]/prebid/workspace.tsx", "app/(internal)/rfqs/rfq-dialog.tsx", "app/(internal)/projects/[id]/climate-workdays-panel.tsx", "app/(internal)/projects/[id]/add-labor-entry-form.tsx", "app/(internal)/projects/[id]/weekly-plan-section.tsx"]) {
      const source = readFileSync(file,"utf8"); expect(source).toContain("Select"); expect(source).not.toMatch(/<select\b/);
    }
  });
});
