#!/usr/bin/env python3
"""Generate per-run evidence checksums and conservative bootstrap completion status."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

SHA="953ebba505b38313bd3e18e6cb9fbf31b7e1eb89"
TREE="a91c8c54dd9d80b7f63a86015eff2e516b21b98f"
def json_or_none(p):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (FileNotFoundError,ValueError,UnicodeError):
        return None

def write(out:Path,repo:str,runid:str):
    out.mkdir(parents=True,exist_ok=True)
    tree=json_or_none(out/"GIT_TREE_ATTESTATION.json")
    src=json_or_none(out/"BOOTSTRAP_SOURCE_ATTESTATION.json")
    scan=json_or_none(out/"STATIC_SCAN_SUMMARY.json")
    schema=json_or_none(out/"SCHEMA_RECONSTRUCTION_RESULT.json")
    errors=[]
    if not src or src.get("source_commit_verified")!=SHA or src.get("source_tree_verified")!=TREE:
        errors.append("Frozen checkout identity not proven")
    if not tree or tree.get("files")!=1584 or tree.get("directories")!=293 or not tree.get("git_checkout_blobs_crosschecked"):
        errors.append("Full REST/local Git inventory not proven")
    if not scan or scan.get("files_from_git")!=1584: errors.append("Source signals inventory not completed")
    if not (out/"RUNNER_SELFTESTS_STATUS.txt").exists():
        errors.append("Audit tooling selftests not attested")
    if not (out/"DOCKER_EGRESS_GUARD.txt").exists(): errors.append("Docker egress guard not attested")
    if not (out/"NODE_INSTALL_ATTESTATION.txt").exists() or "npm_ci_exit_code=0" not in (out/"NODE_INSTALL_ATTESTATION.txt").read_text():
        errors.append("Node/npm installation not proven")
    if not schema or schema.get("schema_rebuild_status")!="PASS_RECONSTRUCTED_LOCAL":
        errors.append("Local PostgreSQL 17 schema reconstruction not proven")
    files=[]
    for p in sorted(out.rglob("*")):
        if not p.is_file() or p.name in ("EVIDENCE_MANIFEST.json","FILE_CHECKSUMS.sha256"):
            continue
        r=str(p.relative_to(out))
        digest=hashlib.sha256(p.read_bytes()).hexdigest()
        files.append({"path":r,"sha256":digest,"size_bytes":p.stat().st_size})
    (out/"FILE_CHECKSUMS.sha256").write_text(
        "".join(f"{r['sha256']}  {r['path']}\n" for r in files),encoding="utf-8")
    result={
        "audit_scope":"RUNNER_BOOTSTRAP_CAPACITY_ONLY",
        "certification_status":"NOT_A_CERTIFICATION",
        "workflow_run_url":f"https://github.com/{repo}/actions/runs/{runid}",
        "artifact_name":f"SENTINEL-V3-BOOTSTRAP-{runid}",
        "expected_sha":SHA,"expected_tree":TREE,
        "runner_bootstrap_capacity":"COMPLETE" if not errors else "INCOMPLETE",
        "blockers":errors,
        "inventory_files":tree.get("files") if tree else None,
        "reviewed_files":0, "executed_erp_tests":0,
        "schema":schema.get("schema_rebuild_status") if schema else "NOT_EXECUTED",
        "files":files,
        "utc":datetime.now(timezone.utc).isoformat(),
    }
    (out/"EVIDENCE_MANIFEST.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print("BOOTSTRAP_CAPACITY="+result["runner_bootstrap_capacity"])
    print("ARTIFACT_NAME="+result["artifact_name"])
    print("WORKFLOW_RUN_URL="+result["workflow_run_url"])
    print("NO_CERTIFICATION_ERP=TRUE")
    return result

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--out",type=Path,required=True)
    ap.add_argument("--repository",required=True)
    ap.add_argument("--run-id",required=True)
    a=ap.parse_args()
    write(a.out,a.repository,a.run_id)
