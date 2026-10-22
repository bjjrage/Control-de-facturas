import { defineConfig, devices } from '@playwright/test';
import { createGuardedLocalWebServer, loadPlaywrightTestEnvironment } from './test-utils/playwright-safety';
loadPlaywrightTestEnvironment();
if(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname!=='kyiihlkncatojvlasoag.supabase.co') throw Error('Solo QA');
const {baseURL,...server}=createGuardedLocalWebServer('http://127.0.0.1:3028','Beta corrections QA');
if(new URL(baseURL).port!=='3028') throw Error('Puerto de QA inesperado');
export default defineConfig({
  testDir:'./tests/beta',timeout:120000,expect:{timeout:20000},workers:1,retries:0,
  reporter:[['list'],['json',{outputFile:'.qa/beta-browser-results.json'}]],outputDir:'.qa/beta-browser-artifacts',
  webServer:{...server,command:'npx next start --hostname localhost --port 3028',wait:{stdout:/- Local:\s+http:\/\/localhost:3028/},env:{...server.env,NODE_ENV:'production'},timeout:120000},
  use:{...devices['Desktop Chrome'],baseURL:'http://localhost:3028',screenshot:'on',trace:'retain-on-failure'},
});
