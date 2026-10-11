import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const DB_URL = process.env.TEST_DATABASE_URL;
if (!DB_URL) throw Error("TEST_DATABASE_URL missing");
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(DB_URL).hostname)) {
  throw Error("REFUSED: nonlocal database");
}
const connect = async () => {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  await c.query("SET statement_timeout='12s'; SET lock_timeout='6s'");
  return c;
};
async function asUser(c, id, fn) {
  await c.query("SET ROLE authenticated");
  await c.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[id]);
  try { return await fn(); }
  finally {
    await c.query("RESET ROLE");
    await c.query("RESET request.jwt.claim.sub");
    await c.query("RESET request.jwt.claim.role");
  }
}
async function run() {
  const c = await connect();
  const ids = {
    companyA: randomUUID(), companyB: randomUUID(),
    companyAAdmin: randomUUID(), companyAAdministracion: randomUUID(),
    companyBAdmin: randomUUID(), task: randomUUID(), approval: randomUUID()
  };
  const findings = [];
  try {
    const v=await c.query("SELECT current_setting('server_version_num') AS value");
    assert.ok(+v.rows[0].value>=170000 && +v.rows[0].value<180000);
    await c.query("BEGIN");
    try {
      await c.query("INSERT INTO public.empresas(id,nombre,slug) VALUES($1,'Audit tenant A',$3),($2,'Audit tenant B',$4)",[ids.companyA,ids.companyB,"v3-agent-"+ids.companyA,"v3-agent-"+ids.companyB]);
      const userRows=[
        [ids.companyAAdmin,ids.companyA,"admin"],
        [ids.companyAAdministracion,ids.companyA,"administracion"],
        [ids.companyBAdmin,ids.companyB,"admin"]
      ];
      for (const [uid,empresa,role] of userRows) {
        const email=uid+"@v3-audit.invalid";
        await c.query("INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES($1,'authenticated','authenticated',$2,now(),'{}'::jsonb,'{}'::jsonb)",[uid,email]);
        await c.query("INSERT INTO public.profiles(id,email,full_name,role,empresa_id) VALUES($1,$2,'V3 auditor fixture',$3::public.user_role,$4)",[uid,email,role,empresa]);
      }
      await c.query("INSERT INTO public.agent_tasks(id,empresa_id,user_id,type,status,context_json) VALUES ($1,$2,$3,'USER_INTENT','PENDING','{}'::jsonb)",[ids.task,ids.companyA,ids.companyAAdmin]);
      await c.query("INSERT INTO public.agent_approvals(id,task_id,empresa_id,tool_name,payload_json,payload_hash,risk_level,status,requested_by) VALUES($1,$2,$3,'send_email','{}'::jsonb,$4,2,'REQUESTED',$5)",[ids.approval,ids.task,ids.companyA,"0".repeat(64),ids.companyAAdmin]);
      await c.query("COMMIT");
    } catch(e) { await c.query("ROLLBACK");throw e; }

    const eventsReg=await c.query("SELECT to_regclass('public.agent_events')::text AS events, to_regprocedure('public.process_agent_event(uuid,uuid,uuid)')::text AS event_rpc");
    findings.push({check:"EVENT_STORAGE",events_table:eventsReg.rows[0].events,event_rpc:eventsReg.rows[0].event_rpc});

    const externalRead=await asUser(c,ids.companyBAdmin,()=>c.query("SELECT id FROM public.agent_approvals WHERE id=$1",[ids.approval]));
    const externalWrite=await asUser(c,ids.companyBAdmin,()=>c.query("UPDATE public.agent_approvals SET status='APPROVED',decided_by=$2 WHERE id=$1 RETURNING id",[ids.approval,ids.companyBAdmin]));
    assert.equal(externalRead.rows.length,0);
    assert.equal(externalWrite.rowCount,0);
    findings.push({check:"CROSS_TENANT_RLS",outcome:"DENIED",visible_rows:0,updated_rows:0});

    const sameTenantRead=await asUser(c,ids.companyAAdministracion,()=>c.query("SELECT id,status,tool_name FROM public.agent_approvals WHERE id=$1",[ids.approval]));
    assert.equal(sameTenantRead.rows.length,1);
    const unauthorizedApprove=await asUser(c,ids.companyAAdministracion,()=>c.query("UPDATE public.agent_approvals SET status='APPROVED',decided_by=$2,decided_at=now() WHERE id=$1 AND status='REQUESTED' RETURNING id,status,decided_by",[ids.approval,ids.companyAAdministracion]));
    assert.equal(unauthorizedApprove.rowCount,1,"Expected role-insensitive same-tenant SQL UPDATE");
    assert.equal(unauthorizedApprove.rows[0].status,"APPROVED");
    findings.push({check:"ROLE_RESTRICTED_APPROVAL_SQL",outcome:"BYPASS_REPRODUCED",actual_role:"administracion",tool:"send_email",required_roles:["comercial","admin"],transition:"REQUESTED->APPROVED",changed_decided_by:true});

    const invalidTransition=await asUser(c,ids.companyAAdministracion,()=>c.query("UPDATE public.agent_approvals SET status='EXECUTED' WHERE id=$1 AND status='APPROVED' RETURNING status",[ids.approval]));
    assert.equal(invalidTransition.rowCount,1);
    assert.equal(invalidTransition.rows[0].status,"EXECUTED");
    findings.push({check:"DIRECT_TERMINAL_STATUS_WRITE",outcome:"BYPASS_REPRODUCED",transition:"APPROVED->EXECUTED",tool_handler_invoked:false});

    const finalState=await c.query("SELECT status,decided_by FROM public.agent_approvals WHERE id=$1",[ids.approval]);
    assert.equal(finalState.rows[0].status,"EXECUTED");
    console.log(JSON.stringify({category:"V3_AGENT_AUTHORIZATION_ADVERSARIAL",frozen_source_sha:"953ebba505b38313bd3e18e6cb9fbf31b7e1eb89",db_env:"disposable-local-postgres17",checks:findings},null,2));
  } finally {
    await c.end();
  }
}
run().catch(e=>{console.error(JSON.stringify({kind:"AUDIT_HARNESS_ERROR",message:String(e),sqlstate:e.code||null}));process.exitCode=1;});
