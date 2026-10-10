#!/usr/bin/env python3
"""Baseline semantic SIGNAL inventory, NOT source code certification.

Scans all tracked textual source files in an independently pinned checkout.
Outputs filename candidates and bounded line references. Regexes are heuristic:
all critical matches need human/AST/DB-contract review before E1+ coverage.
"""
from __future__ import annotations
import argparse
from collections import Counter
import csv
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

SOURCE_SUFFIXES={".ts",".tsx",".js",".jsx",".mts",".mjs",".cjs",".sql",".py",".sh",".bash",
                 ".go",".rs",".php",".yml",".yaml",".json",".toml",".ps1",".mdx"}
TEST_NAMES=re.compile(r"(^|/)(__tests__|tests?|e2e|integration)(/|$)|"
                      r"(?i:\.(test|spec)\.(?:[cm]?[jt]sx?|mts|cts)$)",re.I)
TEST_IDENT=re.compile(r"\b(?:describe|test|it)\s*(?:\.\s*(?:skip|todo|only|each|fails))*\s*\(",re.I)
SKIP_IDENT=re.compile(r"\b(?:describe|test|it)\s*\.\s*(?:skip|todo|only|fails)\s*\(|"
                      r"\b(?:describe|test|it)\s*\.\s*skipIf\s*\(|"
                      r"\b(?:describe|test|it)\s*\.\s*runIf\s*\(|"
                      r"\btest\.fixme\s*\(",re.I)
MUTATION_SIGNALS=[
    ("API_MUTATING_HTTP_METHOD",re.compile(r"\b(?:export\s+(?:async\s+)?(?:function|const)\s+)(?:POST|PUT|PATCH|DELETE)\b")),
    ("SUPABASE_MUTATION",re.compile(r"\.\s*(?:insert|update|upsert|delete)\s*\(")),
    ("DB_RPC_CALL",re.compile(r"\.\s*rpc\s*\(")),
    ("SQL_DML",re.compile(r"\b(?:INSERT\s+INTO|UPDATE\s+\w+|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE|DROP\s+(?:TABLE|SCHEMA))\b",re.I)),
    ("NETWORK_WRITE",re.compile(r"\b(?:fetch|axios\.(?:post|put|patch|delete))\s*\(")),
    ("FILE_OR_STORAGE_WRITE",re.compile(r"\.\s*(?:upload|remove|move|copy|createSignedUploadUrl)\s*\(")),
    ("SERVER_ACTION_MARKER",re.compile(r"['\"]use server['\"]")),
]
ENTRY_PATTERN=re.compile(r"^app/(?:.*/)?(?:page|layout|route|loading|error|not-found|template)\.[jt]sx?$|^pages/(?:.*/)?[^/]+\.[jt]sx?$",re.I)
SPECIAL_ENTRY=re.compile(r"^(?:middleware|proxy)\.[jt]sx?$|^pages/api/|^worker/(?:index|main)\.[jt]s$|"
                         r"^supabase/functions/[^/]+/index\.[jt]s$",re.I)
EXCLUSION_SIGNALS=re.compile(r"\b(?:exclude|testIgnore|testMatch|testDir|projects|passWithNoTests|"
                             r"skip|only|todo|testTimeout|CI)\b",re.I)
LEGACY=re.compile(r"(?:^|[./_-])(?:legacy|old|deprecated|archive|backup|pending|obsolete)(?:[./_-]|$)",re.I)

def git_files(root):
    p=subprocess.run(["git","-C",str(root),"ls-files","-z"],capture_output=True,timeout=80)
    if p.returncode: raise RuntimeError("git ls-files failed")
    return [x.decode("utf-8","surrogateescape") for x in p.stdout.split(b"\0") if x]

def save_csv(path,rows,fields):
    with path.open("w",encoding="utf-8",newline="") as f:
        writer=csv.DictWriter(f,fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

def scan(root,out,inventory):
    if out.resolve()==root.resolve() or root.resolve() in out.resolve().parents:
        raise RuntimeError("Evidence output must be external to audited checkout")
    list_files=git_files(root)
    with inventory.open(encoding="utf-8",newline="") as f:
        rows=list(csv.DictReader(f))
    expected={r["path"] for r in rows}
    if len(expected)!=1584 or set(list_files)!=expected:
        raise RuntimeError("Inventory and checkout paths inconsistent: "+str(len(expected))+" vs "+str(len(list_files)))
    bypath={r["path"]:r for r in rows}
    out.mkdir(parents=True,exist_ok=True)
    entrypoints=[]
    mutations=[]
    tests=[]
    exclusions=[]
    legacy=[]
    scan_count=0
    oversize=[]
    workflows=[]
    migration_rows=[]
    for rel in sorted(list_files):
        p=root/rel
        rec=bypath[rel]
        is_test=bool(TEST_NAMES.search(rel))
        is_entry=bool(ENTRY_PATTERN.search(rel) or SPECIAL_ENTRY.search(rel))
        is_legacy=bool(LEGACY.search(rel))
        if is_legacy:
            legacy.append({"path":rel,"blob_sha":rec["blob_sha"],"review_status":"UNVERIFIED_REACHABILITY"})
        if rel.startswith("supabase/migrations/") and rel.endswith(".sql"):
            migration_rows.append({"path":rel,"blob_sha":rec["blob_sha"],
                "version_prefix":Path(rel).name.split("_",1)[0],
                "size_bytes":rec["size_bytes"],"review_status":"NOT_REVIEWED"})
        if rel.startswith(".github/workflows/") and rel.endswith((".yml",".yaml")):
            workflows.append(rel)
        if is_entry:
            entrypoints.append({"path":rel,"line":1,"signal":"ROUTE_OR_RUNTIME_FILENAME",
                "evidence":"FILENAMES_ONLY","review_status":"NOT_REVIEWED"})
        if p.is_symlink() or not p.is_file():
            if is_test: tests.append({"path":rel,"file_sha":rec["blob_sha"],"line":0,
                                      "signal":"SYMLINK_UNREAD","review_status":"NOT_REVIEWED"})
            continue
        if p.suffix.lower() not in SOURCE_SUFFIXES:
            if is_test:
                tests.append({"path":rel,"file_sha":rec["blob_sha"],"line":0,
                              "signal":"NON_TEXT_TEST_CANDIDATE","review_status":"NOT_REVIEWED"})
            continue
        if p.stat().st_size>5_000_000:
            oversize.append(rel)
            continue
        try:
            content=p.read_text(encoding="utf-8")
        except UnicodeError:
            oversize.append(rel)
            continue
        scan_count+=1
        has_use_server=False
        has_unsafe=False
        num_cases=0
        num_assert=0
        file_exclusions=[]
        for line_nr,line in enumerate(content.splitlines(),1):
            # regex matches are signals, not an execution map
            if "use server" in line: has_use_server=True
            if re.search(r"\b(?:expect|assert)\s*\(",line): num_assert+=1
            if is_test and TEST_IDENT.search(line): num_cases+=len(TEST_IDENT.findall(line))
            if is_test and SKIP_IDENT.search(line):
                tests.append({"path":rel,"file_sha":rec["blob_sha"],"line":line_nr,
                              "signal":"SKIP_TODO_ONLY_OR_CONDITIONAL",
                              "review_status":"NOT_REVIEWED"})
            if ("vitest" in rel.lower() or "playwright" in rel.lower()
                or rel.startswith(".github/workflows/")) and EXCLUSION_SIGNALS.search(line):
                if any(x in line for x in ("exclude","skip","only","testIgnore",
                                            "testMatch","projects","passWithNoTests",
                                            "workflow_dispatch","branches:","paths:")):
                    exclusions.append({"path":rel,"line":line_nr,
                                       "line_sha256":hashlib.sha256(line.encode("utf-8")).hexdigest(),
                                       "review_status":"NOT_VERIFIED"})
            if rel.endswith((".ts",".tsx",".js",".jsx",".sql",".py",".mts",".mjs",".cjs")):
                for reason,pattern in MUTATION_SIGNALS:
                    if pattern.search(line):
                        mutations.append({"path":rel,"line":line_nr,"signal":reason,
                                          "line_sha256":hashlib.sha256(line.encode("utf-8")).hexdigest(),
                                          "review_status":"NOT_REVIEWED"})
        if is_test:
            tests.append({"path":rel,"file_sha":rec["blob_sha"],"line":0,
                          "signal":f"TEST_FILE_CANDIDATE cases~{num_cases} assertions~{num_assert}",
                          "review_status":"NOT_REVIEWED"})
        if has_use_server and not is_entry:
            entrypoints.append({"path":rel,"line":0,"signal":"SERVER_ACTION_MODULE_MARKER",
                                "evidence":"SOURCE_TEXT_SIGNAL","review_status":"NOT_REVIEWED"})
        if rel.startswith(("app/","pages/")) and ("/api/" in rel or rel.endswith("/route.ts")) and not is_entry:
            entrypoints.append({"path":rel,"line":0,"signal":"API_CANDIDATE",
                                "evidence":"FILENAME","review_status":"NOT_REVIEWED"})
    save_csv(out/"SOURCE_ENTRYPOINT_SIGNALS.csv",entrypoints,
             ["path","line","signal","evidence","review_status"])
    save_csv(out/"SOURCE_MUTATION_SIGNALS.csv",mutations,
             ["path","line","signal","line_sha256","review_status"])
    save_csv(out/"SOURCE_TEST_SIGNALS.csv",tests,
             ["path","file_sha","line","signal","review_status"])
    save_csv(out/"SOURCE_EXCLUSIONS_SIGNALS.csv",exclusions,
             ["path","line","line_sha256","review_status"])
    save_csv(out/"SOURCE_LEGACY_SIGNALS.csv",legacy,
             ["path","blob_sha","review_status"])
    save_csv(out/"MIGRATION_ORDER.csv",sorted(migration_rows,key=lambda x:x["path"]),
             ["path","blob_sha","version_prefix","size_bytes","review_status"])
    npm_file=root/"package.json"
    pkg=json.loads(npm_file.read_text(encoding="utf-8"))
    scripts=pkg.get("scripts",{})
    script_rows={k:{"command":v,"status":"DECLARED_NOT_EXECUTED",
                    "mutable_by_name":bool(re.search(
                        r"seed|reset|push|deploy|migrate|sync|apply|write|worker",k,re.I))}
                for k,v in scripts.items()}
    (out/"PACKAGE_SCRIPTS.json").write_text(json.dumps(script_rows,indent=2)+"\n")
    wf_rows=[]
    for rel in workflows:
        src=(root/rel).read_text(encoding="utf-8",errors="replace")
        wf_rows.append({"path":rel,"sha256":hashlib.sha256(src.encode()).hexdigest(),
                        "lines":len(src.splitlines()),"status":"TRIGGERS_AND_GATES_NOT_AUDITED"})
    (out/"WORKFLOW_INDEX.json").write_text(json.dumps(wf_rows,indent=2)+"\n")
    summary={
        "source_commit":"953ebba505b38313bd3e18e6cb9fbf31b7e1eb89",
        "files_from_git":len(list_files),"text_files_scanned":scan_count,
        "files_exceeding_scan_limits":oversize,
        "entrypoint_signals":len(entrypoints),"mutable_code_signals":len(mutations),
        "test_signal_rows":len(tests),"test_candidate_files":len(set(x["path"] for x in tests)),
        "skip_todo_only_signal_rows":sum("SKIP" in x["signal"] for x in tests),
        "exclusion_signal_rows":len(exclusions),"legacy_path_candidates":len(legacy),
        "workflow_files":len(workflows),"migration_files":len(migration_rows),
        "package_script_count":len(scripts),
        "semantic_limit":"Signals are not a complete AST callgraph, effective test runner, DB mapping or verified reachability.",
        "coverage_status":"E0_EVIDENCE_ONLY; ZERO FILES CREDITED AS AUDITED",
    }
    (out/"STATIC_SCAN_SUMMARY.json").write_text(json.dumps(summary,indent=2)+"\n")
    return summary

def cli():
    ap=argparse.ArgumentParser()
    ap.add_argument("--source",type=Path,required=True)
    ap.add_argument("--inventory",type=Path,required=True)
    ap.add_argument("--out",type=Path,required=True)
    opts=ap.parse_args()
    try:
        info=scan(opts.source.resolve(),opts.out.resolve(),opts.inventory.resolve())
    except Exception as exc:
        print("FAIL_CLOSED:",str(exc),file=sys.stderr);sys.exit(3)
    print(json.dumps(info,ensure_ascii=False,indent=2))

if __name__=="__main__": cli()
