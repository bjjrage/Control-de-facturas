import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { it, expect } from "vitest";

it("clean provider-ID migration adds only nullable text, without backfill or uniqueness", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE sales_documents(id text PRIMARY KEY, cdc text); INSERT INTO sales_documents VALUES('legacy','existing-cdc');");
    const before = (await db.query("SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_name='sales_documents' ORDER BY ordinal_position")).rows;
    await db.exec(readFileSync(resolve(process.cwd(),"supabase/migrations/20261004050753_goekua_document_identifier.sql"),"utf8"));
    const after = (await db.query("SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_name='sales_documents' ORDER BY ordinal_position")).rows;
    expect(after).toEqual([...before,{column_name:"goekua_document_id",data_type:"text",is_nullable:"YES"}]);
    expect((await db.query("SELECT * FROM sales_documents")).rows).toEqual([{id:"legacy",cdc:"existing-cdc",goekua_document_id:null}]);
    await db.exec("INSERT INTO sales_documents VALUES('a',NULL,'same-id'),('b',NULL,'same-id');");
  } finally { await db.close(); }
},20000);
