#!/usr/bin/env python3
"""Preflight fail-closed for the SENTINEL V3 isolated GitHub runner.
No dependencies and no application modules imported.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlparse

REPO = "bjjrage/Control-de-facturas"
BRANCH = "refs/heads/audit/engineering-v3-bootstrap"
SHA = "953ebba505b38313bd3e18e6cb9fbf31b7e1eb89"
TREE = "a91c8c54dd9d80b7f63a86015eff2e516b21b98f"
ALLOWED = (".github/workflows/engineering-v3-bootstrap.yml", "audit/v3-bootstrap/")
DENIED_ENV = {
    "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "DATABASE_URL", "DIRECT_URL", "DB_URL", "TEST_DATABASE_URL", "PGHOST",
    "PGSERVICE", "PGSERVICEFILE", "PGPASSWORD", "POSTGRES_URL", "POSTGRES_PRISMA_URL",
    "VERCEL_TOKEN", "RAILWAY_TOKEN", "RAILWAY_API_TOKEN", "RAILWAY_ENVIRONMENT_ID",
    "RAILWAY_PROJECT_ID", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY",
    "STRIPE_SECRET_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "NPM_TOKEN",
    "GH_TOKEN", "GITHUB_TOKEN", "DOCKER_HOST", "KUBECONFIG",
}
ENV_SUFFIXES = ("_DATABASE_URL", "_DB_URL", "_SERVICE_ROLE_KEY", "_SECRET_KEY")
SAFE_ENV_PAT = re.compile(r"^\.env(?:$|\.)", re.I)

def run(*cmd: str, cwd: Path | None = None) -> bytes:
    p = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=75)
    if p.returncode:
        raise RuntimeError("Command failed: " + cmd[0] + " [exit=" + str(p.returncode) + "] "
                           + p.stderr.decode(errors="replace")[:300])
    return p.stdout.strip()

def fail(message: str):
    raise RuntimeError(message)

def assert_no_production_context(src: Path):
    suspect = sorted(k for k,v in os.environ.items() if v and
        (k in DENIED_ENV or k.endswith(ENV_SUFFIXES) or k.startswith("SUPABASE_")))
    if suspect:
        fail("Forbidden potential production environment variable(s): "+", ".join(suspect))
    if Path.home().joinpath(".supabase/access-token").exists():
        fail("Supabase CLI account access token found in HOME")
    bad=[]
    for rel in ("supabase/.temp/project-ref", "supabase/.branches/_current_branch",
                ".supabase/project-ref", ".env", ".env.local", ".env.production",
                ".env.test", "supabase/.env", "supabase/.env.local"):
        if (src / rel).exists(): bad.append(rel)
    # git-tracked env files may have non-obvious names, such as .env.staging.
    tracked=run("git","-C",str(src),"ls-files","-z").split(b"\0")
    for raw_path in tracked:
        if not raw_path: continue
        rel=raw_path.decode("utf-8","surrogateescape")
        name=Path(rel).name
        if SAFE_ENV_PAT.match(name) and name not in (".env.example",".env.sample",
                                                      ".env.template",".env.defaults"):
            bad.append(rel)
    if bad:
        fail("Linked project/environment file is present; refuse execution: "+", ".join(sorted(set(bad))[:20]))
    npmrc = src/".npmrc"
    if npmrc.is_file():
        body=npmrc.read_text(encoding="utf-8",errors="replace")
        if re.search(r"(?i)(authToken|_password|password|username)\s*=",body):
            fail("Repository .npmrc contains authentication material")
    cfg=src/"supabase/config.toml"
    if not cfg.is_file(): fail("supabase/config.toml missing")
    body=cfg.read_text(encoding="utf-8")
    if not re.search(r"(?m)^\s*major_version\s*=\s*17\s*(?:#.*)?$",body):
        fail("Supabase config does not pin PostgreSQL 17")
    for text,expect in [("project_id", "Control_de_Facturas")]:
        if not re.search(r'(?m)^\s*'+text+r'\s*=\s*"' + re.escape(expect)+r'"\s*$',body):
            fail("Supabase config project id unexpected")
    if not (src/"package-lock.json").is_file(): fail("Lockfile missing; npm ci cannot be deterministic")
    return "PASS"

def ls_tree(repo: Path, rev: str) -> dict[str,tuple[str,str,str]]:
    output=run("git","-C",str(repo),"ls-tree","-r","-z",rev)
    result={}
    for part in output.split(b"\0"):
        if not part: continue
        header,path=part.split(b"\t",1)
        mode,kind,sha=header.decode("ascii").split()
        name=path.decode("utf-8","surrogateescape")
        if name in result: fail("Duplicate Git path: "+name)
        result[name]=(mode,kind,sha)
    return result

def assert_checkout_clean(path: Path):
    if run("git","-C",str(path),"status","--porcelain","--untracked-files=normal"):
        fail("Checkout has uncommitted changes or unexpected files: "+str(path))

def check_context():
    for key,expected in (("GITHUB_REPOSITORY",REPO),
                         ("GITHUB_REF",BRANCH),
                         ("GITHUB_EVENT_NAME","push")):
        if os.environ.get(key)!=expected:
            fail("Refuse non-authorized event "+key+"="+repr(os.environ.get(key)))
    if os.environ.get("GITHUB_ACTIONS")!="true":
        fail("Runner execution is restricted to real GitHub Actions context")
    if os.environ.get("RUNNER_OS")!="Linux":
        fail("Expected Linux runner")
    return True

def attestation(src: Path, bootstrap: Path, output: Path):
    check_context()
    assert_no_production_context(src)
    if run("git","-C",str(src),"rev-parse","HEAD").decode()!=SHA:
        fail("Frozen HEAD mismatch")
    if run("git","-C",str(src),"rev-parse","HEAD^{tree}").decode()!=TREE:
        fail("Frozen Git tree mismatch")
    frozen=ls_tree(src,SHA)
    branch=ls_tree(bootstrap,"HEAD")
    delta=sorted(p for p in set(frozen)|set(branch) if frozen.get(p)!=branch.get(p))
    unauthorized=[p for p in delta if p!=ALLOWED[0] and not p.startswith(ALLOWED[1])]
    if unauthorized:
        fail("Branch changes functional code or unapproved path: "+repr(unauthorized[:20]))
    if ALLOWED[0] not in branch: fail("Bootstrap workflow not present on branch")
    assert_checkout_clean(src)
    assert_checkout_clean(bootstrap)
    # Enforce basic Git object connectivity; git diff validates worktree contents.
    for srcpath in (src, bootstrap):
        run("git","-C",str(srcpath),"diff","--quiet")
        run("git","-C",str(srcpath),"diff","--cached","--quiet")
    output.mkdir(parents=True, exist_ok=True)
    att={
        "source_commit_verified":SHA, "source_tree_verified":TREE,
        "branch_ref_verified":BRANCH,
        "branch_commit":run("git","-C",str(bootstrap),"rev-parse","HEAD").decode(),
        "branch_source_diffs":delta, "changed_files_count":len(delta),
        "tracked_source_files":len(frozen), "preflight_production_env":"PASS",
        "scope":"runner/bootstrap only; not engineering certification",
    }
    (output/"BOOTSTRAP_SOURCE_ATTESTATION.json").write_text(
        json.dumps(att,indent=2,ensure_ascii=False)+"\n")
    return att

def assert_local_url(url: str, label: str, port: int) -> dict:
    parsed=urlparse(url)
    if parsed.scheme not in ("http","https","postgresql","postgres"):
        fail(label+" invalid URI scheme")
    if (parsed.hostname not in ("localhost","127.0.0.1","::1") or parsed.port!=port):
        fail(label+" is not the required loopback:"+str(port))
    return {"scheme":parsed.scheme, "host":parsed.hostname, "port":parsed.port}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--source",type=Path,required=True)
    ap.add_argument("--bootstrap",type=Path)
    ap.add_argument("--evidence",type=Path)
    ap.add_argument("--check-only",action="store_true")
    args=ap.parse_args()
    try:
        if args.check_only:
            assert_no_production_context(args.source)
            print("SAFE_PRECHECK=PASS")
        else:
            if not args.bootstrap or not args.evidence: fail("Missing branch checkout/evidence path")
            result=attestation(args.source,args.bootstrap,args.evidence)
            print("FROZEN_SOURCE_VERIFIED="+result["source_commit_verified"])
            print("GIT_TREE_VERIFIED="+result["source_tree_verified"])
            print("BRANCH_DELTA_ALLOWED="+str(result["changed_files_count"]))
    except Exception as exc:
        print("FAIL_CLOSED: "+str(exc), file=sys.stderr)
        sys.exit(3)

if __name__=="__main__": main()
