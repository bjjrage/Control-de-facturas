/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node QA runner. */
// Isolated browser regression: real shell/navigation components, simulated
// Next history and read actions. No server, credentials, database or business writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium, expect } = require('@playwright/test');

const root = path.resolve(__dirname, '../..');
const actions = {
  getDashboardData: '/dashboard', getInvoicesData: '/invoices', getOrdersData: '/orders',
  getPagosData: '/pagos', getProvidersData: '/providers', getRfqsData: '/rfqs',
  getClientesData: '/clientes', getCobrosData: '/cobros', getProjectsData: '/projects',
  getStockData: '/stock', getInventarioData: '/inventario',
};
const sectionExports = [
  'ProjectsSection', 'StockSection', 'InventarioGlobalSection', 'DashboardSection',
  'InvoicesSection', 'OrdersSection', 'PagosSection', 'ProvidersSection', 'RfqsSection',
  'ClientesSection', 'CobrosSection', 'SalesListSection',
];

async function bundle() {
  const result = await build({
    stdin: { resolveDir: root, sourcefile: 'shell-test-entry.tsx', loader: 'tsx', contents: `
      import React, {useState, useMemo, useEffect} from 'react';
      import {createRoot} from 'react-dom/client';
      import {AppShellClient} from '@/components/layout/app-shell-client';
      import {Sidebar} from '@/components/layout/sidebar';
      import {Topbar} from '@/components/layout/topbar';
      const options = window.__options || {};
      const state = window.__shell = {
        calls: [], mounts: [], held: new Set(options.held || []), pending: [], version: 0,
        failures: new Set(),
        read(route) {
          state.calls.push(route);
          const data = {label: route, version: state.version};
          if(state.failures.delete(route)) return Promise.reject(new Error('simulated offline'));
          if(state.held.has(route)) return new Promise(resolve => state.pending.push({route, resolve, data}));
          return Promise.resolve(data);
        },
        release(route) {
          const index = state.pending.findIndex(p => p.route === route);
          if(index < 0) throw Error('No held read: ' + route);
          const [p] = state.pending.splice(index, 1); p.resolve(p.data);
        },
        intent(route) {window.dispatchEvent(new CustomEvent('niupack:prefetch', {detail: route}));},
        cancel(route) {window.dispatchEvent(new CustomEvent('niupack:cancel-prefetch', {detail: route}));},
        navigate(route) {window.dispatchEvent(new CustomEvent('niupack:navigate', {detail: route}));},
      };
      const push = history.pushState.bind(history), replace = history.replaceState.bind(history);
      history.pushState = (...args) => {push(...args);window.dispatchEvent(new Event('test:path'));};
      history.replaceState = (...args) => {replace(...args);window.dispatchEvent(new Event('test:path'));};
      function App() {
        const [revision, setRevision] = useState(0), [scope, setScope] = useState(0);
        const [allowed, setAllowed] = useState(options.allowed || Object.values(${JSON.stringify(actions)}));
        state.refresh = () => {state.version++; setRevision(r => r+1);};
        state.server = route => {history.pushState({}, '', route); state.refresh();};
        state.remount = () => setScope(s => s+1);
        state.allow = setAllowed;
        const children = useMemo(() => <h1>Server {location.pathname} r{revision}</h1>, [revision]);
        useEffect(() => {window.__ready = true;}, []);
        return <><Sidebar role="admin" fullName="QA" plan="pro" modules={{compras:true,ventas:true}} />
          <Topbar showOperativo showLicitaciones />
          <AppShellClient key={scope} warmPaths={allowed}>{children}</AppShellClient></>;
      }
      createRoot(document.getElementById('root')).render(<App />);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_SUPABASE_URL': '""' },
    plugins: [{ name: 'isolated-shell', setup(api) {
      api.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: 'mock-next' }));
      api.onLoad({ filter: /.*/, namespace: 'mock-next' }, args => ({ loader: 'tsx', resolveDir: root, contents: args.path.endsWith('navigation') ? `
        import {useSyncExternalStore} from 'react';
        const subscribe = f => {window.addEventListener('test:path',f);window.addEventListener('popstate',f);
          return () => {window.removeEventListener('test:path',f);window.removeEventListener('popstate',f);};};
        export const usePathname = () => useSyncExternalStore(subscribe, () => location.pathname);
        export const useRouter = () => ({push: url => window.__shell.server(url)});
      ` : `
        import React from 'react';
        export default function Link({children, prefetch, onClick, ...props}) {
          return <a {...props} data-next-prefetch={String(prefetch)} onClick={e => {
            onClick?.(e);
            if(!e.defaultPrevented && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.button===0) {
              e.preventDefault();window.__shell.server(props.href);
            }
          }}>{children}</a>;
        }
      ` }));
      api.onResolve({ filter: /^@\/app\/\(internal\)\/.*(section-action|sales-list-section-action)$/ }, args => ({ path: args.path, namespace: 'mock-actions' }));
      api.onLoad({ filter: /.*/, namespace: 'mock-actions' }, () => ({ contents:
        Object.entries(actions).map(([name, route]) => `export const ${name} = () => window.__shell.read('${route}');`).join('\n') +
        `export const getSalesListData = type => window.__shell.read({PROFORMA:'/proformas',REMISION:'/remisiones',FACTURA:'/facturas-venta'}[type]);`
      }));
      api.onResolve({ filter: /^@\/app\/\(internal\)\/.*(-section|inventario-global-section)$/ }, args => ({ path: args.path, namespace: 'mock-screen' }));
      api.onLoad({ filter: /.*/, namespace: 'mock-screen' }, () => ({ loader: 'tsx', resolveDir: root, contents: `
        import React, {useEffect, useState} from 'react';
        function Screen(props) {
          const data = props.data || props.initialData || props;
          const [filter, setFilter] = useState('');
          useEffect(() => {window.__shell.mounts.push(data.label);}, []);
          return <section><h1>{data.label} v{data.version}</h1><input aria-label={'filter '+data.label} value={filter} onChange={e=>setFilter(e.target.value)} /></section>;
        }
        ${sectionExports.map(name => `export const ${name} = Screen;`).join('\n')}
      ` }));
      api.onResolve({ filter: /^@\/app\/\(internal\)\/(actions|projects\/actions)$/ }, args => ({ path: args.path, namespace: 'mock-other' }));
      api.onResolve({ filter: /^\.\/(branding-actions|theme-switcher)$/ }, args => ({ path: args.path, namespace: 'mock-other' }));
      api.onLoad({ filter: /.*/, namespace: 'mock-other' }, () => ({ contents:
        'export const logout=()=>{}; export const getProjectNavInfo=async()=>null; export const uploadLogo=async()=>({}); export const ThemeSwitcher=()=>null;'
      }));
    } }],
  });
  return result.outputFiles[0].text;
}

(async () => {
  const source = await bundle();
  const browser = await chromium.launch({ headless: true });
  const results = [];
  async function scenario(name, run, options = {}) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (route.request().url().startsWith('http://shell.test/')) return route.fulfill({ contentType: 'text/html', body:
        '<!doctype html><style>[hidden]{display:none!important}aside{width:180px;float:left}.workspace-switcher{display:flex}a{display:inline-block;margin:4px}</style><div id="root"></div>' });
      external.push(route.request().url()); return route.abort();
    });
    try {
      await page.goto('http://shell.test/dashboard');
      await page.evaluate(value => { window.__options = value; }, options);
      await page.addScriptTag({ content: source });
      await page.waitForFunction(() => window.__ready);
      await run(page);
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      results.push({ name, status: 'PASS' });
    } finally { await page.close(); }
  }
  const heading = page => page.locator('.erp-workspace:not([hidden]) h1');
  try {
    await scenario('initial SSR has zero duplicate or speculative reads', async page => {
      await expect(heading(page)).toHaveText('Server /dashboard r0');
      await page.waitForTimeout(350);
      assert.deepEqual(await page.evaluate(() => window.__shell.calls), []);
    });
    await scenario('hover + click + pathname share one read; prefetch does not mount', async page => {
      const link = page.locator('.workspace-switcher a[href="/projects"]');
      await expect(link).toHaveAttribute('data-next-prefetch', 'false');
      await link.hover();
      await page.waitForFunction(() => window.__shell.calls.length === 1);
      assert.deepEqual(await page.evaluate(() => window.__shell.mounts), []);
      await link.click();
      await page.waitForTimeout(250);
      assert.deepEqual(await page.evaluate(() => window.__shell.calls), ['/projects']);
      await page.evaluate(() => window.__shell.release('/projects'));
      await expect(heading(page)).toHaveText('/projects v0');
    }, { held: ['/projects'] });
    await scenario('canceled hover does no work; foreground beats pending intent', async page => {
      await page.evaluate(() => {window.__shell.intent('/stock');window.__shell.cancel('/stock');});
      await page.waitForTimeout(220);
      assert.deepEqual(await page.evaluate(() => window.__shell.calls), []);
      await page.evaluate(() => {window.__shell.intent('/stock');window.__shell.navigate('/projects');});
      await expect(heading(page)).toHaveText('/projects v0');
      await page.waitForTimeout(220);
      assert.deepEqual(await page.evaluate(() => window.__shell.calls), ['/projects']);
    });
    await scenario('prefetch obeys permissions and never queues behind active reads', async page => {
      await page.evaluate(() => window.__shell.intent('/invoices'));
      await page.waitForTimeout(220);
      assert.deepEqual(await page.evaluate(() => window.__shell.calls), []);
      await page.evaluate(() => window.__shell.navigate('/projects'));
      await page.waitForFunction(() => window.__shell.calls.length === 1);
      await page.evaluate(() => window.__shell.intent('/stock'));
      await page.waitForTimeout(220);
      assert.deepEqual(await page.evaluate(() => window.__shell.calls), ['/projects']);
      await page.evaluate(() => window.__shell.release('/projects'));
      await expect(heading(page)).toHaveText('/projects v0');
    }, { held: ['/projects'], allowed: ['/projects', '/stock'] });
    await scenario('old responses cannot replace another server-rendered route', async page => {
      await page.evaluate(() => {window.__shell.navigate('/projects');window.__shell.navigate('/stock');});
      await expect(heading(page)).toHaveText('/stock v0');
      await page.evaluate(() => window.__shell.server('/agent/activity'));
      await expect(heading(page)).toHaveText('Server /agent/activity r1');
      await page.evaluate(() => window.__shell.release('/projects'));
      await page.waitForTimeout(50);
      await expect(heading(page)).toHaveText('Server /agent/activity r1');
      assert.equal(await page.evaluate(() => location.pathname), '/agent/activity');
    }, { held: ['/projects'] });
    await scenario('mutation refresh rejects old data and requests a fresh snapshot', async page => {
      await page.evaluate(() => window.__shell.navigate('/projects'));
      await page.waitForFunction(() => window.__shell.calls.length === 1);
      await page.evaluate(() => window.__shell.refresh());
      await page.waitForFunction(() => window.__shell.calls.length === 2);
      await page.evaluate(() => window.__shell.release('/projects'));
      await expect(heading(page)).toHaveText('Server /projects r1');
      await page.evaluate(() => window.__shell.release('/projects'));
      await expect(heading(page)).toHaveText('/projects v1');
    }, { held: ['/projects'] });
    await scenario('failed intent prefetch retries on navigation', async page => {
      await page.evaluate(() => {window.__shell.failures.add('/projects');window.__shell.intent('/projects');});
      await page.waitForFunction(() => window.__shell.calls.length === 1);
      await page.evaluate(() => window.__shell.navigate('/projects'));
      await expect(heading(page)).toHaveText('/projects v0');
      assert.equal(await page.evaluate(() => window.__shell.calls.length), 2);
    });
    await scenario('a prepared screen appears while its fresh read is still pending', async page => {
      await page.evaluate(() => window.__shell.intent('/projects'));
      await page.waitForFunction(() => window.__shell.calls.length === 1);
      await page.evaluate(() => {window.__shell.version=1;window.__shell.held.add('/projects');window.__shell.navigate('/projects');});
      // The new read cannot complete until explicitly released below.
      await expect(heading(page)).toHaveText('/projects v0');
      await page.waitForFunction(() => window.__shell.pending.length === 1);
      await page.evaluate(() => window.__shell.release('/projects'));
      await expect(heading(page)).toHaveText('/projects v1');
    });
    await scenario('back/forward keeps filters and revalidates visible data', async page => {
      await page.evaluate(() => window.__shell.navigate('/invoices'));
      await expect(heading(page)).toHaveText('/invoices v0');
      await page.getByLabel('filter /invoices').fill('filter preserved');
      await page.evaluate(() => window.__shell.navigate('/projects'));
      await expect(heading(page)).toHaveText('/projects v0');
      await page.goBack();
      await expect(heading(page)).toHaveText('/invoices v0');
      await expect(page.getByLabel('filter /invoices')).toHaveValue('filter preserved');
      await page.goForward();
      await expect(heading(page)).toHaveText('/projects v0');
      assert.deepEqual(await page.evaluate(() => window.__shell.calls), ['/invoices', '/projects', '/invoices', '/projects']);
    });
    await scenario('keyboard intent works and a new shell cannot reuse old snapshots', async page => {
      const link = page.locator('.workspace-switcher a[href="/projects"]');
      await link.focus();
      await page.waitForFunction(() => window.__shell.calls.length === 1);
      await link.press('Enter');
      await expect(heading(page)).toHaveText('/projects v0');
      await page.evaluate(() => {window.__shell.version=1;window.__shell.remount();});
      await expect(heading(page)).toHaveText('Server /dashboard r0');
      await page.evaluate(() => window.__shell.navigate('/projects'));
      await expect(heading(page)).toHaveText('/projects v1');
    });
    await scenario('Ctrl/Cmd click preserves native link behavior in both menus', async page => {
      await page.evaluate(() => {
        window.__modifiedPrevented=[];
        document.addEventListener('click', event => {
          window.__modifiedPrevented.push(event.defaultPrevented);
          // Observe the application result, then suppress opening test tabs.
          event.preventDefault();
        });
      });
      for (const modifier of ['Control', 'Meta']) {
        await page.locator('.erp-sidebar a[href="/dashboard"]').click({modifiers:[modifier]});
        await page.locator('.workspace-switcher a[href="/projects"]').click({modifiers:[modifier]});
      }
      assert.deepEqual(await page.evaluate(() => window.__modifiedPrevented), [false,false,false,false]);
      assert.equal(await page.evaluate(() => location.pathname), '/dashboard');
    });
    const report = { status: 'PASS', simulatedServer: true, externalRequests: 0, results };
    if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
