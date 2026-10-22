import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const users=JSON.parse(readFileSync('.qa/users.json','utf8'));
export async function login(page:Page,who:'admin_a'|'administracion_a'|'comercial_a'|'admin_b') {
  await page.context().clearCookies();await page.goto('/login');
  await page.getByLabel(/email/i).fill(users[who].email);
  await page.getByLabel(/contraseña|password/i).fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button',{name:/ingresar|login|entrar/i}).click();
  await page.waitForURL(u=>!u.pathname.startsWith('/login'),{timeout:60000});
  await expect(page).not.toHaveURL(/login/);
}
export async function go(page:Page,path:string){await page.goto(path);await page.waitForLoadState('networkidle').catch(()=>{});}
