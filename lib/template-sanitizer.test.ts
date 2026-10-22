import { afterEach, describe, expect, it, vi } from "vitest";
import { DomUtils, ElementType, parseDocument } from "htmlparser2";
import { renderTemplate } from "./template";
import { sanitizeTemplateHtml, substituteTemplateValues } from "./template-sanitizer";
import type { Client, Empresa, SalesDocument, SalesDocumentItem } from "./types";

afterEach(() => vi.unstubAllEnvs());

describe("invoice template sanitization", () => {
  it("keeps A4 print layout while removing active HTML and external resource sinks", () => {
    const safe = sanitizeTemplateHtml(`
      <style>
        @page { size: A4; margin: 12mm; }
        @media print { body { width: 210mm; color: #111; } .items, td { padding: 3px 4px; } }
        @import url(https://attacker.invalid/steal.css);
        @font-face { font-family: remote; src: url(https://attacker.invalid/font.woff); }
        .items { background-image: url(https://attacker.invalid/pixel); position: fixed; color: #222; }
      </style>
      <h1 class="items" style="color: #123456; background-image: url(https://attacker.invalid/inline)">Invoice</h1>
      <img src="{{LOGO_URL}}" alt="logo" onerror="alert(1)">
      <img src="https://attacker.invalid/pixel" alt="remote">
      <iframe srcdoc="<script>alert(1)</script>"><img src="{{LOGO_URL}}"></iframe>
      <svg><image href="javascript:alert(1)"></image></svg>
      <script>alert(1)</script>
    `);

    expect(safe).toMatch(/@page\s*\{[^}]*size:\s*A4;[^}]*margin:\s*12mm/);
    expect(safe).toContain("@media print");
    expect(safe).toContain("[data-company-template]");
    expect(safe).toMatch(/width:\s*210mm/);
    expect(safe).toMatch(/color:\s*#222/);
    expect(safe).toContain('src="{{LOGO_URL}}"');
    expect(safe).toContain("color:#123456");
    expect(safe).not.toContain("attacker.invalid");
    expect(safe).not.toContain("background-image");
    expect(safe).not.toContain("position:fixed");
    expect(safe).not.toContain("onerror");
    expect(safe).not.toContain("srcdoc");
    expect(safe).not.toContain("javascript:");
    expect(safe).not.toContain("<script");
    expect(safe).not.toContain("<iframe");
    expect(safe).not.toContain("<svg");
  });

  it("does not resolve sourceMappingURL comments and keeps parsed safe rules", () => {
    const localMapComment = "/" + "*# sourceMappingURL=" + "file:///private/secret.map *" + "/";
    const remoteMapComment = "/" + "*# sourceMappingURL=" + "https://attacker.invalid/leak.map *" + "/";
    const safe = sanitizeTemplateHtml(`
      <style>
        .invoice { color: black; }
        ${localMapComment}
        ${remoteMapComment}
      </style>
      <p class="invoice">OK</p>
    `);

    expect(safe).toMatch(/color:\s*black/);
    expect(safe).toContain("[data-company-template] .invoice");
    expect(safe).not.toContain("sourceMappingURL");
    expect(safe).not.toContain("private/secret.map");
    expect(safe).not.toContain("attacker.invalid");
  });

  it("is stable when the sanitized template is saved and sanitized again", () => {
    const first = sanitizeTemplateHtml(`
      <style>@page { size: A4; margin: 10mm; } .invoice { color: #123; }</style>
      <div class="invoice">{{DOC_CODIGO}}</div>
    `);

    expect(sanitizeTemplateHtml(first)).toBe(first);
  });

  it("cannot use an already-scoped selector to style a sibling outside the print wrapper", () => {
    const safe = sanitizeTemplateHtml(`
      <style>
        [data-company-template] + .outside { color: red; }
        [data-company-template] ~ .outside { color: blue; }
        .invoice { color: black; }
      </style>
      <div class="invoice">OK</div>
    `);

    expect(safe).toContain("[data-company-template] .invoice");
    expect(safe).not.toContain(".outside");
  });

  it("does not re-interpret placeholder-like text inserted from a company field", () => {
    const safeTemplate = sanitizeTemplateHtml("<p>{{EMPRESA_NOMBRE}}</p>");
    const rendered = substituteTemplateValues(safeTemplate, { "{{EMPRESA_NOMBRE}}": "literal {{ITEMS_HTML}}" }, "<img src=x>", "");

    expect(rendered).toContain("literal {{ITEMS_HTML}}");
    expect(rendered).not.toContain("<img");
  });

  it("escapes database values by HTML context and only injects the trusted item table", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.invalid");
    const empresa = {
      id: "empresa-demo",
      nombre: `ACME "><img src=x onerror=alert(1)> & Co`,
      slug: null,
      active: true,
      modulo_compras: true,
      modulo_ventas: true,
      created_at: "2026-01-01T00:00:00Z",
      ruc: "80000000-1",
      direccion: null,
      telefono: null,
      email_empresa: null,
      template_proforma: null,
      template_remision: null,
      template_factura: null,
      plan: "pro",
    } satisfies Empresa;
    const doc = {
      id: "doc-demo",
      empresa_id: empresa.id,
      client_id: "client-demo",
      code: `INV"><script>alert(1)</script>`,
      doc_type: "FACTURA",
      issue_date: "2026-09-03",
      due_date: null,
      currency: "PYG",
      subtotal: 1000,
      vat_amount: 100,
      total: 1100,
      cobrado_amount: 0,
      status: "EMITIDA",
      notes: `"><img src=x onerror=alert(2)>`,
      cdc: null,
      goekua_document_id: null,
      xml_url: null,
      kude_url: null,
      source_document_id: null,
      quotation_version: 1,
      acceptance_status: "DRAFT",
      acceptance_expires_at: null,
      accepted_at: null,
      accepted_by_name: null,
      accepted_by_doc: null,
      rejected_at: null,
      rejection_reason: null,
      created_by: "user-demo",
      created_at: "2026-09-03T00:00:00Z",
      updated_at: "2026-09-03T00:00:00Z",
    } satisfies SalesDocument;
    const client = {
      id: "client-demo",
      empresa_id: empresa.id,
      name: `Client "><svg onload=alert(3)>`,
      tax_id: null,
      contact_name: null,
      email: null,
      phone: null,
      address: null,
      payment_terms: null,
      active: true,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    } satisfies Client;
    const items: SalesDocumentItem[] = [{
      id: "item-demo",
      empresa_id: empresa.id,
      sales_document_id: doc.id,
      description: `Line "><script>alert(4)</script> & goods`,
      quantity: 1,
      unit_price: 1000,
      vat_rate: 10,
      line_total: 1100,
      created_at: "2026-09-03T00:00:00Z",
    }];

    const output = renderTemplate(
      `<h1 title="{{EMPRESA_NOMBRE}}">{{EMPRESA_NOMBRE}}</h1><p>{{DOC_CODIGO}}</p><p>{{CLIENTE_NOMBRE}}</p><p>{{NOTAS}}</p><div>{{ITEMS_HTML}}</div><img src="{{LOGO_URL}}">`,
      {
        empresa,
        doc,
        client,
        items,
        logoUrl: "https://supabase.example.invalid/storage/v1/object/public/branding/current-logo",
        docTypeLabel: "Factura",
      }
    );

    expect(output).toContain("ACME &quot;&gt;&lt;img src=x onerror=alert(1)&gt; &amp; Co");
    expect(output).toContain("INV&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(output).toContain("Client &quot;&gt;&lt;svg onload=alert(3)&gt;");
    expect(output).toContain("Line &quot;&gt;&lt;script&gt;alert(4)&lt;/script&gt; &amp; goods");
    expect(output).toContain('src="https://supabase.example.invalid/storage/v1/object/public/branding/current-logo"');
    const rendered = parseDocument(output);
    const elements = DomUtils.findAll((element) => element.type === ElementType.Tag || element.type === ElementType.Style, rendered.children);
    expect(elements.some((element) => ["script", "svg"].includes(element.name.toLowerCase()))).toBe(false);
    expect(elements.some((element) => Object.keys(element.attribs).some((attribute) => /^on(?:error|load)$/i.test(attribute)))).toBe(false);
    expect(output).toContain('<table style="width:100%;border-collapse:collapse;font-size:inherit;">');

  });

  it("rejects logo URLs from another origin or bucket", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.invalid");
    const empresa = {
      id: "e", nombre: "Empresa", slug: null, active: true, modulo_compras: true, modulo_ventas: true,
      created_at: "2026-01-01", ruc: null, direccion: null, telefono: null, email_empresa: null,
      template_proforma: null, template_remision: null, template_factura: null, plan: "pro",
    } satisfies Empresa;
    const doc = {
      id: "d", empresa_id: "e", client_id: "c", code: "F-1", doc_type: "FACTURA", issue_date: "2026-09-03",
      due_date: null, currency: "PYG", subtotal: 0, vat_amount: 0, total: 0, cobrado_amount: 0, status: "EMITIDA",
      notes: null, cdc: null, goekua_document_id: null, xml_url: null, kude_url: null, source_document_id: null,
      quotation_version: 1, acceptance_status: "DRAFT", acceptance_expires_at: null, accepted_at: null,
      accepted_by_name: null, accepted_by_doc: null, rejected_at: null, rejection_reason: null,
      created_by: "u", created_at: "2026-09-03", updated_at: "2026-09-03",
    } satisfies SalesDocument;

    const logoUrls = [
      "https://attacker.invalid/storage/v1/object/public/branding/current-logo",
      "https://supabase.example.invalid/storage/v1/object/public/other-bucket/current-logo",
      "https://supabase.example.invalid/storage/v1/object/public/branding/current-logo?cache=1",
    ];

    for (const logoUrl of logoUrls) {
      const output = renderTemplate(`<img src="{{LOGO_URL}}">`, {
        empresa, doc, client: null, items: [], logoUrl, docTypeLabel: "Factura",
      });
      expect(output).not.toContain("attacker.invalid");
      expect(output).not.toContain("src=");
      expect(output).not.toContain("other-bucket");
    }
  });
});
