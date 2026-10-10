#!/usr/bin/env python3
"""Autoprueba determinista del generador V3 usando árbol SINTÉTICO.

NO es prueba del ERP ni usa red ni fuentes GitHub reales.
"""
import hashlib
import importlib.util
import json
import tempfile
from pathlib import Path

modfile=Path(__file__).with_name("baseline_from_github_tree.py")
spec=importlib.util.spec_from_file_location("sentinel_inventory",modfile)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
names=[".github/workflows/example.yml","app/api/demo/route.ts",
       "app/(internal)/invoices/actions.ts","worker/index.ts",
       "supabase/migrations/20261010000001_mock.sql",
       "supabase/migrations_pending/20261011000000_PENDING.sql",
       "test/unit.test.ts","server/auth.ts"]
rows=[]
for i in range(m.EXPECTED_FILES):
    p=names[i] if i<len(names) else f"fixtures/generated{int(i/100):02d}/file-{i:04d}.txt"
    rows.append({"path":p,"type":"blob","mode":"100644",
                 "sha":hashlib.sha1(f"synthetic:{i}".encode()).hexdigest(),"size":i+10})
for i in range(m.EXPECTED_DIRS):
    rows.append({"path":f"directory_{i:04d}", "type":"tree","mode":"040000",
                 "sha":hashlib.sha1(f"synthetic_tree:{i}".encode()).hexdigest()})
good={"sha":m.EXPECTED_TREE,"truncated":False,"tree":rows}
results=[]
with tempfile.TemporaryDirectory(prefix="sentinel-audit-selftest-") as folder:
    dest=Path(folder)
    stats=m.produce(json.dumps(good).encode(),dest,no_source=True)
    assert stats["files"]==1584 and stats["directories"]==293
    assert stats["reviewed_files"]==0 and stats["executed_tests"]==0
    results.append("PASS: counts and truthful E0/0 reviewed")
    assert (dest/"INVENTORY.csv").exists() and (dest/"CI_WORKFLOWS.csv").exists()
    results.append("PASS: full CSV and category indexes produced")
    assert m.classify("supabase/migrations_pending/20261011000000_PENDING.sql","100644","blob")=="DB_MIGRATION_PENDING_OR_LEGACY"
    results.append("PASS: pending migration separated from active schema")
    for test_case in ["truncated", "unexpected_sha", "duplicate_path","missing_blob_size","missing_row"]:
        bad=dict(good)
        if test_case=="truncated": bad["truncated"]=True
        elif test_case=="unexpected_sha":bad["sha"]="a"*40
        elif test_case=="duplicate_path":
            temp=list(rows);temp[1]=dict(temp[0]);bad["tree"]=temp
        elif test_case=="missing_blob_size":
            temp=list(rows);temp[1]=dict(temp[1]);temp[1].pop("size");bad["tree"]=temp
        elif test_case=="missing_row":bad["tree"]=rows[:-1]
        try:
            m.verify_tree(bad)
            raise AssertionError("Fail-open: "+test_case)
        except ValueError:results.append("PASS: fail-closed "+test_case)
for result in results:print(result)
print("SELFTEST PASSED:",len(results),"checks; NO source or ERP test executed.")
