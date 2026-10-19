// Coverage accounting only. A source entry or HTTP 200 is never a UI PASS.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '../../..');
const out = path.join(root, 'audit-evidence/c06-u1-2026-10-19');
const matrixFile = path.join(out, 'u1-matrix.json');

function routeOf(file) {
  return file.replaceAll('\\', '/').replace(/^app/, '').replace(/\/\([^/]+\)/g, '')
    .replace(/\/(?:page\.tsx|route\.ts)$/, '') || '/';
}

function matches(pattern, route) {
  const parts = pattern.split('/').map(p => /^\[(?:id|roomId|orderId|rfqId)\]$/.test(p)
    ? '[0-9a-f]{8}-[0-9a-f-]{27,}'
    : p.startsWith('[') ? '[^/]+' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp('^' + parts.join('/') + '$').test(route.split('?')[0]);
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? walk(path.join(dir, e.name))
    : e.name === 'page.tsx' ? [path.relative(root, path.join(dir, e.name)).replaceAll('\\', '/')] : []);
}

async function main() {
  // Reuse the public, sanitized records: regeneration does not need private tokens or DOM snapshots.
  const records = JSON.parse(fs.readFileSync(matrixFile, 'utf8')).records;
  // These two legacy routes lacked actualRoute in the original capture records.
  const redirects = new Map([['/ventas', '/proformas'], ['/costs', '/orders']]);
  const latest = await Promise.all([...new Map(records.map(r => [r.route, r])).values()].map(async r => {
    const record = { ...r };
    const file = path.join(out, record.capture);
    const image = await sharp(file).metadata();
    if (!['png', 'jpeg'].includes(image.format) || !image.width || !image.height) {
      throw new Error('Invalid capture format or dimensions: ' + record.capture);
    }
    // Legacy field name; these are image pixels, not proof of the browser's CSS viewport.
    record.viewport = { width: image.width, height: image.height };
    record.captureFormat = image.format;
    const pathname = record.route.split('?')[0];
    if (redirects.has(pathname)) record.actualRoute = redirects.get(pathname);
    record.review = record.route === '/empresas' && record.stage !== 'VISUAL_REVIEW_QA_SUPERADMIN'
      ? 'ROLE_GUARD_ONLY'
      : record.actualRoute && record.actualRoute !== pathname ? 'REDIRECT_OR_ALIAS' : 'VISUAL_REVIEWED';
    return record;
  }));
  const pages = walk(path.join(root, 'app')).map(file => ({
    file, route: routeOf(file), captures: latest.filter(r => matches(routeOf(file), r.route)),
  }));
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'docs/audits/2026-10-17-inventario-cobertura.json'), 'utf8')).cases;
  const historical = inventory.map(c => {
    const captures = latest.filter(r => matches(routeOf(c.file), r.route));
    return { ...c, sourceExists: fs.existsSync(path.join(root, c.file)),
      u1: c.kind === 'action' ? 'SERVER_ACTION_NOT_A_SCREEN'
        : c.file.endsWith('/route.ts') ? 'API_OR_EXPORT_NOT_A_SCREEN'
          : !captures.length ? 'PENDING_UI'
            : captures.every(r => r.review === 'REDIRECT_OR_ALIAS') ? 'REDIRECT_OR_ALIAS' : 'VISUAL_CAPTURED',
    };
  });
  const summary = {
    currentPageRoutes: pages.length,
    visuallyReviewedPageRoutes: pages.filter(p => p.captures.some(r => r.review === 'VISUAL_REVIEWED')).length,
    redirectOrAliasPageRoutes: pages.filter(p => p.captures.length && p.captures.every(r => r.review === 'REDIRECT_OR_ALIAS')).length,
    records: latest.length,
    visuallyReviewedRecords: latest.filter(r => r.review === 'VISUAL_REVIEWED').length,
    redirectOrAliasRecords: latest.filter(r => r.review === 'REDIRECT_OR_ALIAS').length,
  };
  const result = {
    scope: '179 historical entries = 129 server actions + 50 surfaces; current page inventory is accounted separately. Captures alone do not certify keyboard or destructive behavior.',
    captureMeasurement: 'viewport stores image pixel dimensions decoded from file contents, not a measured CSS viewport. captureFormat records the actual format regardless of filename extension. DOM references are local ignored snapshots, not committed evidence.',
    summary, historical, pages, records: latest,
  };
  fs.writeFileSync(matrixFile, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ summary,
    historical: { total: historical.length, pending: historical.filter(c => c.u1 === 'PENDING_UI').map(c => ({ id: c.id, file: c.file })) },
    currentPages: { pending: pages.filter(p => !p.captures.length).map(p => p.route) },
  }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
