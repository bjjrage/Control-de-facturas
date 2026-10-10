#!/usr/bin/env python3
"""Start disposable Supabase local, reset ONLY --local --no-seed and attest PG schema.

Never imports application code. Fail closed if a remote DB URL is encountered.
Raw CLI output is kept only in runner temp; artifacts contain filtered diagnostics.
"""
from __future__ import annotations
import argparse
import csv
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlparse

from runner_gate import assert_no_production_context, assert_local_url

DB_PORT=54322
API_PORT=54321
HIGH_RISK=re.compile(r"(?i)(?:secret|token|jwt|password|api.key|anon.key|service.role|db.url|"
                     r"authorization|bearer|postgres(?:ql)?://|supabase_service|sk_[a-z0-9]|eyJ[A-Za-z0-9_-]{15})")

def isolated_env(tmp: Path) -> dict[str,str]:
    home=tmp/"empty-audit-home"
    home.mkdir(parents=True,exist_ok=True)
    env={"PATH":os.environ.get("PATH","/usr/local/bin:/usr/bin:/bin"),
         "HOME":str(home),
         "CI":"true","NO_COLOR":"1","TERM":"dumb","LANG":"C.UTF-8",
         "SUPABASE_NO_UPDATE_CHECK":"1"}
    # No project/link credentials, no GitHub token, no SMTP/API/payment secrets.
    return env

def redact(raw: Path,target: Path):
    lines=raw.read_text(encoding="utf-8",errors="replace").splitlines()
    with target.open("w",encoding="utf-8") as f:
        for idx,line in enumerate(lines[:2500],1):
            if HIGH_RISK.search(line):
                f.write(f"{idx}: [REDACTED: SENSITIVE_OR_URL_LINE]\n")
            else:
                f.write(f"{idx}: {line[:700]}\n")
        if len(lines)>2500:
            f.write(f"[TRUNCATED {len(lines)-2500} more lines; raw retained only on ephemeral runner]\n")

def cmd(cmd:list[str],cwd:Path,env:dict[str,str],raw:Path,log:Path,limit:int=1800):
    try:
        with raw.open("wb") as out:
            proc=subprocess.run(cmd,cwd=cwd,env=env,stdout=out,stderr=subprocess.STDOUT,
                                timeout=limit,check=False)
        redact(raw,log)
        if proc.returncode:
            raise RuntimeError(cmd[0]+" "+cmd[1]+" failed with exit code "+str(proc.returncode))
    except subprocess.TimeoutExpired:
        if raw.exists(): redact(raw,log)
        raise RuntimeError(cmd[0]+" "+cmd[1]+" exceeded timeout "+str(limit))

def check_status(cwd,env):
    proc=subprocess.run(["supabase","status","--output","json"],cwd=cwd,env=env,
                        capture_output=True,timeout=40)
    if proc.returncode: raise RuntimeError("Supabase local status unavailable (exit "+str(proc.returncode)+")")
    try:
        doc=json.loads(proc.stdout)
    except Exception as exc:
        raise RuntimeError("Supabase status invalid JSON (raw output suppressed)") from exc
    # Actual values are used only in memory; never saved with credentials.
    urls={str(k).upper():v for k,v in doc.items() if isinstance(v,str)}
    if "API_URL" not in urls or "DB_URL" not in urls:
        raise RuntimeError("Supabase status missing API_URL/DB_URL")
    api=assert_local_url(urls["API_URL"],"Local API",API_PORT)
    db=assert_local_url(urls["DB_URL"],"Local PostgreSQL",DB_PORT)
    if db["scheme"] not in ("postgresql","postgres"):
        raise RuntimeError("DB URL scheme unexpected")
    return urls["DB_URL"], {"local_api":api, "local_db":db}

def psql(query:str,db_url:str, cwd:Path,env:dict[str,str]) -> str:
    proc=subprocess.run(["psql","--no-psqlrc","-X","-v","ON_ERROR_STOP=1","-qAt",
                         "--dbname",db_url,"-c",query],
                        cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=50)
    if proc.returncode:
        raise RuntimeError("Local psql query failed; see sanitised output only")
    return proc.stdout.decode().strip()

def persist(out:Path,data:dict):
    out.mkdir(parents=True,exist_ok=True)
    (out/"SCHEMA_RECONSTRUCTION_RESULT.json").write_text(json.dumps(data,indent=2,ensure_ascii=False)+"\n")

def run_local(source:Path,out:Path,temp:Path):
    env=isolated_env(temp)
    assert_no_production_context(source)
    if out.resolve()==source.resolve() or source.resolve() in out.resolve().parents:
        raise RuntimeError("Output must be outside application checkout")
    result={"target":"SUPABASE_LOCAL_LOOPBACK_ONLY","sha_expected":"953ebba505b38313bd3e18e6cb9fbf31b7e1eb89",
            "schema_rebuild_status":"FAIL","executed_erp_tests":0,
            "reset_seed_disabled":True, "start_may_execute_local_seed":True,
            "database_target":"UNVERIFIED",
            "errors":[]}
    out.mkdir(parents=True,exist_ok=True)
    try:
        cmd(["supabase","start"],source,env,temp/"supabase-start.raw.log",
            out/"supabase-start.redacted.log",limit=1200)
        db_url,targets=check_status(source,env)
        result["database_target"]="VERIFIED_LOOPBACK"
        result["endpoint_attestation"]=targets
        # Even if Supabase CLI changed defaults, the verified endpoint must be local.
        pgver=psql("select current_setting('server_version_num')",db_url,source,env)
        if not re.fullmatch(r"17\d{4}",pgver):
            raise RuntimeError("Expected PostgreSQL 17, got version_num="+pgver)
        result["postgres_server_version_num"]=int(pgver)
        result["schema_rebuild_command"]="supabase db reset --local --no-seed"
        # The explicit --local is non-negotiable; --linked/--db-url never used.
        cmd(["supabase","db","reset","--local","--no-seed"],source,env,
            temp/"supabase-reset.raw.log",out/"schema-reset.redacted.log",limit=1800)
        db_url,targets=check_status(source,env)
        result["endpoint_post_reset"]=targets
        pgver_after=psql("select current_setting('server_version_num')",db_url,source,env)
        if not re.fullmatch(r"17\d{4}",pgver_after):
            raise RuntimeError("PG major changed after reset")
        versions=psql("select version from supabase_migrations.schema_migrations order by version",
                      db_url,source,env).splitlines()
        (out/"SCHEMA_MIGRATION_APPLIED_VERSIONS.txt").write_text("\n".join(versions)+"\n")
        files=sorted((source/"supabase/migrations").glob("*.sql"))
        expected=[re.match(r"^\d{14}",p.name).group(0)
                  for p in files if re.match(r"^\d{14}_",p.name)]
        ignored=[p.name for p in files if not re.match(r"^\d{14}_",p.name)]
        missing=sorted(set(expected)-set(versions))
        result["schema_version_entries"]=len(versions)
        result["migration_sql_files"]=len(files)
        result["versioned_sql_files"]=len(expected)
        result["nonstandard_sql_filenames"]=ignored
        result["missing_migration_versions"]=missing
        result["catalog"]={
            "public_tables":int(psql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')",db_url,source,env)),
            "rls_enabled_tables":int(psql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity",db_url,source,env)),
            "rls_policies":int(psql("select count(*) from pg_policies where schemaname='public'",db_url,source,env)),
            "public_functions":int(psql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'",db_url,source,env)),
            "user_triggers":int(psql("select count(*) from pg_trigger where not tgisinternal",db_url,source,env)),
        }
        if not files:
            raise RuntimeError("No migration files found")
        if ignored:
            raise RuntimeError("Unrecognized SQL migration filenames: "+str(len(ignored)))
        if missing:
            raise RuntimeError("Migration versions absent from local PG: "+str(len(missing)))
        result["schema_rebuild_status"]="PASS_RECONSTRUCTED_LOCAL"
        result["finished_utc"]=datetime.now(timezone.utc).isoformat()
        persist(out,result)
        print("PG17_LOCAL_SCHEMA=PASS")
        print("MIGRATIONS_APPLIED="+str(len(versions)))
        print("PUBLIC_TABLES="+str(result["catalog"]["public_tables"]))
    except Exception as exc:
        result["errors"]=[str(exc)]
        result["finished_utc"]=datetime.now(timezone.utc).isoformat()
        persist(out,result)
        raise

def cli():
    ap=argparse.ArgumentParser()
    ap.add_argument("--source",required=True,type=Path)
    ap.add_argument("--out",required=True,type=Path)
    ap.add_argument("--temp",required=True,type=Path)
    args=ap.parse_args()
    try:
        run_local(args.source.resolve(),args.out.resolve(),args.temp.resolve())
    except Exception as exc:
        print("FAIL_CLOSED_SCHEMA: "+str(exc),file=sys.stderr)
        sys.exit(3)

if __name__=="__main__":cli()
