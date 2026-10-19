const { env, fs, path, root, assert } = require('./context.cjs');
Object.assign(process.env, env);
const Module = require('node:module');
const ts = require('typescript');
Module._extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { extractInvoiceFieldsFromPdf } = require('../../../lib/invoice-extraction.ts');
(async () => {
 const { PDFParse } = require('pdf-parse');
 const parser = new PDFParse({ data: fs.readFileSync(path.join(root, 'test/fixtures/invoices/c06-scan.pdf')) });
 const image = await parser.getScreenshot({ desiredWidth: 1200 });
 fs.writeFileSync(path.join(root, 'audit-evidence/c06-u1-2026-10-19/c06-render.png'), image.pages[0].data);
 await parser.destroy();
 const result = await extractInvoiceFieldsFromPdf(fs.readFileSync(path.join(root, 'test/fixtures/invoices/c06-scan.pdf')));
 console.log(JSON.stringify(result));
 assert.equal(result.error, null);
 assert.equal(result.data.provider_tax_id.replace(/\D/g, ''), '800999991');
 assert.equal(result.data.total, 110000);
})().catch(e => { console.error(e); process.exitCode = 1; });
