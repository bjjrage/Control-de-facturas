#!/usr/bin/env python3
"""Fail closed on non-approved package-lock fetch hosts. Does not download packages."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
from urllib.parse import urlparse

ALLOWED={"registry.npmjs.org","cdn.sheetjs.com"}
def check(lock_file:Path,output:Path):
    obj=json.loads(lock_file.read_text(encoding="utf-8"))
    lock_ver=obj.get("lockfileVersion")
    if lock_ver not in (2,3): raise RuntimeError("Unsupported/unreproducible npm lockfile version")
    packages=obj.get("packages")
    if not isinstance(packages,dict) or not packages: raise RuntimeError("Missing locked packages")
    hosts={}
    offenders=[]
    no_integrity=[]
    for name,info in packages.items():
        if not isinstance(info,dict): continue
        url=info.get("resolved")
        if not url or not isinstance(url,str): continue
        parsed=urlparse(url)
        if parsed.scheme!="https" or parsed.hostname not in ALLOWED:
            offenders.append({"package":name,"host":parsed.hostname,"scheme":parsed.scheme})
        else:
            hosts[parsed.hostname]=hosts.get(parsed.hostname,0)+1
        if parsed.scheme=="https" and not info.get("integrity"):
            no_integrity.append(name)
    summary={"lockfile_version":lock_ver,"package_count":len(packages),
             "download_hosts":hosts,"unexpected_hosts":offenders,
             "missing_integrity":no_integrity,
             "result":"PASS" if not offenders else "FAIL",
             "policy":"HTTPS registry.npmjs.org and cdn.sheetjs.com only; no auth tokens"}
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n")
    if offenders: raise RuntimeError("Package-lock includes disallowed download hosts")
    return summary
if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--lock",required=True,type=Path)
    ap.add_argument("--out",required=True,type=Path)
    a=ap.parse_args()
    try: print("NPM_LOCK_PREFLIGHT="+check(a.lock,a.out)["result"])
    except Exception as exc:
        print("FAIL_CLOSED: "+str(exc),file=sys.stderr);sys.exit(3)
