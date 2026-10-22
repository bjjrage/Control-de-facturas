import { afterAll, beforeAll, beforeEach, afterEach, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const E="10000000-0000-4000-8000-000000000001", E2="10000000-0000-4000-8000-000000000002";
const P="20000000-0000-4000-8000-000000000001", B="30000000-0000-4000-8000-000000000001";
let db:PGlite;
beforeAll(async()=>{
 db=new PGlite();await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA private;
 CREATE TABLE public.projects(id uuid PRIMARY KEY);
 CREATE TABLE public.project_certificates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid REFERENCES projects(id),status text DEFAULT 'BORRADOR');
 CREATE TABLE public.project_certificate_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),certificate_id uuid REFERENCES project_certificates(id),budget_item_id uuid,qty_contractual numeric NOT NULL,qty_anterior numeric NOT NULL,qty_presente numeric NOT NULL);
 CREATE TABLE public.providers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid NOT NULL,name text NOT NULL,tax_id text,created_at timestamptz DEFAULT now());
 INSERT INTO public.providers(empresa_id,name,tax_id) VALUES('${E}','Original','800.111-7'),('${E}','Duplicado histórico','8001117');
 INSERT INTO public.projects VALUES('${P}');`);
 for(const name of ['20261022022745_beta_certificate_quantity_cap.sql','20261022022747_beta_provider_tax_identity.sql'])await db.exec(readFileSync(resolve('supabase/migrations',name),'utf8'));
},60000);
afterAll(async()=>{await db?.close();});beforeEach(async()=>{await db.exec('BEGIN');});afterEach(async()=>{await db.exec('ROLLBACK');});
async function draft(present:number,previous=0){const r=await db.query<{id:string}>('INSERT INTO public.project_certificates(project_id) VALUES($1) RETURNING id',[P]);const id=r.rows[0].id;await db.query('INSERT INTO public.project_certificate_items(certificate_id,budget_item_id,qty_contractual,qty_anterior,qty_presente) VALUES($1,$2,100,$3,$4)',[id,B,previous,present]);return id;}
it('rejects over-certification on insert, rather than only in the UI',async()=>{await expect(draft(95,10)).rejects.toThrow(/contratada/);});
it('accepts the exact contractual limit and rejects an over-limit edit',async()=>{const id=await draft(90,10);await expect(db.query('UPDATE project_certificate_items SET qty_presente=91 WHERE certificate_id=$1',[id])).rejects.toThrow(/contratada/);});
it('rechecks another draft when submitting, after the first draft was frozen',async()=>{const a=await draft(60),b=await draft(60);await db.query("UPDATE project_certificates SET status='ELABORADO' WHERE id=$1",[a]);await expect(db.query("UPDATE project_certificates SET status='ELABORADO' WHERE id=$1",[b])).rejects.toThrow(/contratada/);});
it('does not let a forged previous quantity exceed the remaining contract',async()=>{const a=await draft(80);await db.query("UPDATE project_certificates SET status='ELABORADO' WHERE id=$1",[a]);await expect(draft(30,0)).rejects.toThrow(/contratada/);});
it('preserves historical duplicate providers without enabling new duplicates',async()=>{const rows=await db.query<{name:string,tax_id_dedup_exempt:boolean}>('SELECT name,tax_id_dedup_exempt FROM providers ORDER BY name');expect(rows.rows).toHaveLength(2);expect(rows.rows.filter(r=>r.tax_id_dedup_exempt)).toHaveLength(1);await expect(db.query('INSERT INTO providers(empresa_id,name,tax_id,tax_id_dedup_exempt) VALUES($1,$2,$3,true)',[E,'Intento nuevo','800-1117'])).rejects.toThrow(/RUC/);});
it('allows the same RUC in another tenant and permits providers without RUC',async()=>{await db.query('INSERT INTO providers(empresa_id,name,tax_id) VALUES($1,$2,$3)',[E2,'Otra empresa','8001117']);await db.query('INSERT INTO providers(empresa_id,name) VALUES($1,$2),($1,$3)',[E,'Sin RUC 1','Sin RUC 2']);expect((await db.query('SELECT id FROM providers')).rows).toHaveLength(5);});
