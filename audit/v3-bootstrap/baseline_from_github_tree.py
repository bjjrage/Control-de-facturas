#!/usr/bin/env python3
"""SENTINEL V3. Genera inventario de SOLO LECTURA desde GitHub REST o JSON guardado.

Dependencias: Python >=3.10, libreria estandar. No requiere credenciales,
no ejecuta código de Control de Facturas, no conecta a Supabase, Vercel o Railway.
Nunca crea una fila inventada. Abortará si el árbol no está completo.

Uso externo autorizado:
  python baseline_from_github_tree.py --download --out /tmp/AUDIT-CODE-V3-TREE
  python baseline_from_github_tree.py --tree-json tree.json --out /tmp/AUDIT-CODE-V3-TREE
  python baseline_from_github_tree.py --tree-json tree.json --repo /path/repo --out /tmp/AUDIT-CODE-V3-TREE
"""
import argparse
import csv
import hashlib
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

OWNER = "bjjrage"
REPO = "Control-de-facturas"
FROZEN_COMMIT = "953ebba505b38313bd3e18e6cb9fbf31b7e1eb89"
EXPECTED_TREE = "a91c8c54dd9d80b7f63a86015eff2e516b21b98f"
EXPECTED_TOTAL = 1877
EXPECTED_FILES = 1584
EXPECTED_DIRS = 293
API_URL = f"https://api.github.com/repos/{OWNER}/{REPO}/git/trees/{EXPECTED_TREE}?recursive=1"
E0 = "E0_METADATA_ONLY"
HEX40 = re.compile(r"^[0-9a-f]{40}$")
EXEC = {".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cjs", ".py", ".sh",
        ".bash", ".ps1", ".sql", ".go", ".rs", ".rb", ".php"}
TEST_PATTERN = re.compile(
    r"(^|/)(__tests__|tests?|e2e|fixtures|mocks|mock-data)(/|$)|"
    r"(?:\.|[-_])(spec|test|tests)(?:\.[a-z0-9]+)?$",
    re.I,
)
ROUTE_PATTERN = re.compile(r"(^|/)(route|page|layout|template|loading|error|not-found)\.[jt]sx?$", re.I)
ACTION_PATTERN = re.compile(r"(^|/)(actions?|server-actions?|mutations?|handlers?)\.[jt]sx?$", re.I)
WRITES = re.compile(r"(actions?|mutations?|create|update|delete|remove|void|cancel|approve|"
                    r"pay|payment|receipt|transfer|reconcile|match|import|upload|save|"
                    r"insert|worker|webhook|checkout|billing|sync|publish|post|process|"
                    r"ingest|job|execute|rpc|cron)", re.I)
LEGACY = re.compile(r"(^|/)(legacy|old|deprecated|archive|archived|v1|backup|"
                    r"migrations_pending|pending|obsolete|_unused)(/|$)|(?:^|[._-])(legacy|old|deprecated|bak)(?:[._-]|$)", re.I)

def read_rest():
    req = urllib.request.Request(
        API_URL,
        headers={"Accept": "application/vnd.github+json",
                 "User-Agent": "sentinel-v3-read-only-inventory",
                 "X-GitHub-Api-Version": "2022-11-28"})
    with urllib.request.urlopen(req, timeout=40) as result:
        raw = result.read(20_000_001)
    if len(raw) > 20_000_000:
        raise ValueError("JSON mayor a 20 MB. Revisión manual requerida.")
    return raw

def load_json(raw):
    try:
        return json.loads(raw)
    except (ValueError, UnicodeError) as err:
        raise ValueError("Respuesta REST no es JSON válido") from err

def checked_path(path):
    if not isinstance(path, str) or not path or path.startswith("/") or "\\" in path:
        raise ValueError(f"Ruta Git inválida: {path!r}")
    if any(part in {"..", ".", ""} for part in path.split("/")):
        raise ValueError(f"Ruta Git ambigua: {path!r}")
    if "\0" in path or "\n" in path or "\r" in path:
        raise ValueError("Ruta con caracteres de control")
    return path

def is_test(path):
    return bool(TEST_PATTERN.search(path))

def classify(path, mode, typ):
    p = path.lower()
    ext = Path(path).suffix.lower()
    if typ == "commit": return "SUBMODULE_GITLINK"
    if mode == "120000": return "SYMLINK"
    if p.startswith(".github/workflows/"): return "CI_WORKFLOW"
    if p.startswith(".github/") or p.startswith(".githooks/"): return "CI_SECURITY_CONFIG"
    if p.startswith("supabase/migrations/") and ext == ".sql": return "DB_MIGRATION_ACTIVE"
    if p.startswith("supabase/migrations_pending/"): return "DB_MIGRATION_PENDING_OR_LEGACY"
    if p.startswith("supabase/functions/"): return "SUPABASE_EDGE_FUNCTION"
    if p.startswith("supabase/") and ext == ".sql": return "DB_SQL_OTHER"
    if p.startswith("supabase/"): return "DB_CONFIGURATION"
    if is_test(path):
        if ext in {".ts",".tsx",".js",".jsx",".mts",".mjs",".cjs",".py",".sql",".sh"}:
            return "TEST_EXECUTABLE"
        return "TEST_FIXTURE_OR_DATA"
    if p.startswith("app/api/") or (p.startswith("app/") and "/api/" in p): return "NEXT_API"
    if p.startswith("app/"): return "APP_PAGE_COMPONENT_OR_ACTION"
    if p.startswith("pages/api/"): return "LEGACY_API"
    if p.startswith("worker/"): return "WORKER"
    if p.startswith("server/"): return "BACKEND_SERVER"
    if p.startswith("lib/"): return "DOMAIN_SERVICE"
    if p.startswith("components/"): return "UI_COMPONENT"
    if p.startswith("scripts/"): return "OPERATIONAL_SCRIPT"
    if p.startswith("test-utils/"): return "TEST_TOOLING"
    if p.startswith("public/"): return "PUBLIC_ASSET"
    if ext in {".md",".mdx",".rst",".txt"}: return "DOCUMENTATION"
    if ext in {".png",".jpg",".jpeg",".gif",".webp",".svg",".pdf",".xlsx",".xls",".zip",".wasm",".ico"}:
        return "ASSET_OR_BINARY"
    if ext in {".yml",".yaml",".toml",".json",".config",".lock",".ini"} or path in {"Dockerfile", "Procfile"}:
        return "CONFIG_OR_MANIFEST"
    if ext in EXEC: return "ROOT_OR_MISC_EXECUTABLE"
    return "OTHER"

def module_of(path):
    parts = path.split("/")
    p = path.lower()
    if p.startswith("app/"):
        first = next((part for part in parts[1:] if not part.startswith("(")), "_root")
        if first == "api" and len(parts) > 2:
            return "app/api/" + parts[2]
        return "app/" + first
    if p.startswith("supabase/migrations/"): return "database/migrations"
    if p.startswith("supabase/migrations_pending/"): return "database/pending"
    if p.startswith("supabase/functions/"): return "database/edge-functions"
    if p.startswith("lib/"):
        key = parts[1] if len(parts)>1 else "_root"
        if key.startswith("invoice"): return "lib/invoices"
        if key.startswith("payment"): return "lib/payments"
        return "lib/" + key
    if p.startswith(".github/"): return "ci/github"
    return (parts[0]+"/"+parts[1] if len(parts)>2 and parts[0] in
            {"server","components","worker","scripts","tests","test","test-utils"} else parts[0])

def entrypoint_candidate(path, category):
    base = Path(path).name.lower()
    p = path.lower()
    reasons = []
    if ROUTE_PATTERN.search(path) and p.startswith(("app/","pages/")): reasons.append("NEXT_PUBLIC_OR_RENDER_ROUTE")
    if ACTION_PATTERN.search(path) and p.startswith(("app/","server/")): reasons.append("NEXT_SERVER_ACTION_CANDIDATE")
    if p.startswith("pages/api/") or category == "NEXT_API": reasons.append("HTTP_ENDPOINT_CANDIDATE")
    if p.startswith("supabase/functions/") and base in {"index.ts","index.js"}: reasons.append("SUPABASE_EDGE_ENTRY")
    if p.startswith("worker/") and base in {"index.ts","index.js","main.ts","main.js"}: reasons.append("WORKER_MAIN")
    if p in {"proxy.ts","middleware.ts","proxy.js","middleware.js"}: reasons.append("REQUEST_PROXY_MIDDLEWARE")
    if p in {"procfile","railway.json","vercel.json","dockerfile","docker-compose.yml","docker-compose.enterprise.yml"}:
        reasons.append("DEPLOYMENT_STARTUP")
    if category == "CI_WORKFLOW": reasons.append("CI_ENTRY")
    if p.startswith("supabase/migrations/") and p.endswith(".sql"): reasons.append("SCHEMA_CHANGE")
    if p.startswith("scripts/") and Path(path).suffix.lower() in EXEC: reasons.append("OPERATOR_EXECUTION_CANDIDATE")
    return ";".join(reasons)

def criticality(path, category):
    p = path.lower()
    if category in {"DB_MIGRATION_ACTIVE","SUPABASE_EDGE_FUNCTION","CI_WORKFLOW"}:
        return "P0_REVIEW_FIRST"
    if any(x in p for x in ("auth","tenant","empresa","rls","payment","pago","invoice","factura",
                            "receipt","recepcion","stock","inventory","order","orden",
                            "storage","worker","webhook","cron","permission","role")):
        return "P0_REVIEW_FIRST"
    if category in {"NEXT_API","BACKEND_SERVER","WORKER","DB_MIGRATION_PENDING_OR_LEGACY"}:
        return "P1_HIGH"
    if category in {"DOMAIN_SERVICE","OPERATIONAL_SCRIPT","APP_PAGE_COMPONENT_OR_ACTION",
                    "TEST_EXECUTABLE","LEGACY_API"}: return "P2_NORMAL"
    return "P3_REVIEW_METADATA"

def package_of(path, category):
    p = path.lower()
    if category.startswith("CI_") or p in {"railway.json","next.config.ts","procfile",
        "docker-compose.enterprise.yml",".env.example","package.json","package-lock.json"}:
        return "A_REPO_CI_RELEASE"
    if p.startswith("supabase/"): return "D_DB_SCHEMA_MIGRATIONS"
    if category in {"TEST_EXECUTABLE","TEST_FIXTURE_OR_DATA","TEST_TOOLING"}: return "H_TEST_CERTIFICATION"
    if any(k in p for k in ("/auth","/tenant","empresa","permission","rls","storage","proxy.ts")): return "B_AUTH_TENANT"
    if any(k in p for k in ("invoice","factura","payment","pago","cobro","reconcile")): return "C_INVOICES_PAYMENTS"
    if category == "WORKER" or any(k in p for k in ("job","agent","extraction","ocr","ai-")):
        return "F_WORKERS_AI"
    if any(k in p for k in ("order","orden","stock","warehouse","inventory","recepcion","project","obra")):
        return "E_PURCHASING_STOCK_PROJECTS"
    if category in {"OPERATIONAL_SCRIPT","CONFIG_OR_MANIFEST"}: return "A_REPO_CI_RELEASE"
    return "G_OTHER_APPLICATION"

def verify_tree(document):
    if not isinstance(document,dict): raise ValueError("JSON raíz no es objeto")
    if document.get("truncated") is not False:
        raise ValueError("GitHub no certifica truncated:false; inventario abortado")
    if document.get("sha") != EXPECTED_TREE:
        raise ValueError("Git tree inesperado: SHA distinto del congelado")
    entries = document.get("tree")
    if not isinstance(entries,list): raise ValueError("No existe array tree")
    if len(entries) != EXPECTED_TOTAL:
        raise ValueError(f"Total de entradas inesperado: {len(entries)} != {EXPECTED_TOTAL}")
    seen = set()
    blobs = 0
    dirs = 0
    for item in entries:
        path=checked_path(item.get("path"))
        if path in seen: raise ValueError("Ruta Git duplicada: "+path)
        seen.add(path)
        typ=item.get("type")
        if typ not in {"tree","blob","commit"}: raise ValueError("Tipo Git inesperado: "+repr(typ))
        if not HEX40.fullmatch(item.get("sha", "")): raise ValueError("Blob/tree SHA inválido "+path)
        if not isinstance(item.get("mode"),str): raise ValueError("Modo Git inválido")
        if typ=="tree": dirs+=1
        else:
            blobs+=1
            size=item.get("size")
            if typ=="blob" and (not isinstance(size,int) or size<0):
                raise ValueError("Blob sin tamaño válido: "+path)
    if dirs!=EXPECTED_DIRS or blobs!=EXPECTED_FILES:
        raise ValueError(f"Árbol incompleto/desconocido: {blobs} files, {dirs} dirs")
    return entries

def verify_local_git(repo, entries):
    repo=Path(repo).expanduser().resolve()
    def call(*args):
        r=subprocess.run(["git","-C",str(repo),*args],capture_output=True,timeout=45)
        if r.returncode: raise ValueError("git verification fail "+str(args)+": "+r.stderr.decode(errors="replace")[:350])
        return r.stdout
    if call("rev-parse", f"{FROZEN_COMMIT}^{{commit}}").strip().decode()!=FROZEN_COMMIT:
        raise ValueError("Commit no disponible en checkout local")
    if call("rev-parse", f"{FROZEN_COMMIT}^{{tree}}").strip().decode()!=EXPECTED_TREE:
        raise ValueError("Árbol Git local no coincide")
    actual={}
    for rawline in call("ls-tree","-r","-l","-z",FROZEN_COMMIT).split(b"\0"):
        if not rawline: continue
        left,rawpath=rawline.split(b"\t",1)
        fields=left.split()
        if len(fields)!=4: raise ValueError("ls-tree unexpected format")
        mode,typ,sha,size=fields
        actual[rawpath.decode("utf-8","surrogateescape")] = (mode.decode(),typ.decode(),sha.decode(),size.decode())
    files=[row for row in entries if row["type"]!="tree"]
    if len(actual)!=len(files): raise ValueError("local file count differs")
    for item in files:
        path=item["path"]
        if path not in actual: raise ValueError("local file missing: "+path)
        mode,typ,sha,size=actual[path]
        if (mode.lstrip("0"),typ,sha)!=(item["mode"].lstrip("0"),item["type"],item["sha"]):
            raise ValueError("git object differs: "+path)
        if typ=="blob" and int(size)!=item["size"]:
            raise ValueError("git blob size differs: "+path)
    return True

def write_csv(path, rows, fields):
    with path.open("w",encoding="utf-8",newline="") as f:
        writer=csv.DictWriter(f,fieldnames=fields,extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

def produce(raw, out, repo=None, no_source=False):
    doc=load_json(raw)
    entries=verify_tree(doc)
    local_ok=verify_local_git(repo,entries) if repo else False
    if out.resolve() == (Path(repo).expanduser().resolve() if repo else None):
        raise ValueError("Salida no debe escribirse dentro del checkout")
    if repo and Path(repo).expanduser().resolve() in out.resolve().parents:
        raise ValueError("Salida externa al checkout requerida")
    out.mkdir(parents=True,exist_ok=True)
    if not no_source:
        (out/"GIT_TREE_SOURCE.json").write_bytes(raw)
    rows=[]
    for item in entries:
        if item["type"]=="tree": continue
        p=item["path"]
        category=classify(p,item["mode"],item["type"])
        entry=entrypoint_candidate(p,category)
        legacy=bool(LEGACY.search(p))
        wr=bool(WRITES.search(p)) and (category in {"NEXT_API","APP_PAGE_COMPONENT_OR_ACTION",
             "BACKEND_SERVER","DOMAIN_SERVICE","WORKER","OPERATIONAL_SCRIPT","SUPABASE_EDGE_FUNCTION","LEGACY_API"})
        records={
            "path":p,"blob_sha":item["sha"] if item["type"]=="blob" else "",
            "gitlink_commit_sha":item["sha"] if item["type"]=="commit" else "",
            "size_bytes":item.get("size",""),
            "git_type":item["type"],"git_mode":item["mode"],"technical_class":category,
            "module":module_of(p),"review_priority":criticality(p,category),
            "review_package":package_of(p,category),"entrypoint_candidate":entry or "",
            "mutable_operation_candidate":"YES_BY_NAME_ONLY" if wr else "",
            "test_candidate":"YES" if category=="TEST_EXECUTABLE" else "",
            "legacy_candidate":"YES_NAME_ONLY" if legacy else "",
            "review_coverage":E0,"review_status":"NOT_REVIEWED",
            "independent_review":"NOT_ASSIGNED","dynamic_test":"NOT_EXECUTED",
            "assessment_limits":"Filename heuristics only; must inspect executable content",
        }
        rows.append(records)
    rows.sort(key=lambda r:r["path"].casefold())
    fields=list(rows[0])
    write_csv(out/"INVENTORY.csv",rows,fields)
    mappings = {
        "ENTRYPOINT_CANDIDATES.csv":[r for r in rows if r["entrypoint_candidate"]],
        "MUTABLE_CANDIDATES.csv":[r for r in rows if r["mutable_operation_candidate"]],
        "TEST_INVENTORY.csv":[r for r in rows if r["test_candidate"]],
        "DB_MIGRATION_INVENTORY.csv":[r for r in rows if "MIGRATION" in r["technical_class"]],
        "WORKER_INVENTORY.csv":[r for r in rows if r["technical_class"] in {"WORKER","SUPABASE_EDGE_FUNCTION"}],
        "LEGACY_CANDIDATES.csv":[r for r in rows if r["legacy_candidate"] or r["technical_class"] in {"LEGACY_API","DB_MIGRATION_PENDING_OR_LEGACY"}],
        "CI_WORKFLOWS.csv":[r for r in rows if r["technical_class"]=="CI_WORKFLOW"],
    }
    for filename,subset in mappings.items():
        write_csv(out/filename,subset,fields)
    group=Counter((r["review_package"],r["technical_class"]) for r in rows)
    write_csv(out/"MODULE_COUNTS.csv",
        [{"review_package":a,"technical_class":b,"paths":n,"reviewed":0}
         for (a,b),n in sorted(group.items())],
        ["review_package","technical_class","paths","reviewed"])
    summary={
        "audit_version":"V3",
        "expected_commit":FROZEN_COMMIT,
        "tree_sha":EXPECTED_TREE,
        "tree_data_url":API_URL,
        "raw_tree_sha256":hashlib.sha256(raw).hexdigest(),
        "source_saved":not no_source,
        "source_obtained":"passed JSON or downloaded by authorized runner",
        "truncated":False,
        "entries":len(entries),
        "files":len(rows),
        "directories":sum(x["type"]=="tree" for x in entries),
        "all_metadata_sha_present":True,
        "git_checkout_blobs_crosschecked":local_ok,
        "reviewed_files":0,
        "executed_tests":0,
        "test_classification":"filename heuristic; not complete test registration",
        "source_inspection":"NOT PERFORMED BY THIS SCRIPT",
        "category_counts":dict(Counter(r["technical_class"] for r in rows)),
        "module_counts":dict(Counter(r["review_package"] for r in rows)),
        "candidate_counts":{k:len(v) for k,v in mappings.items()},
        "api_tree_evidence_level":"E0_METADATA_ONLY",
        "notes":["Blob SHA is evidence of Git object identity, NOT evidence of code review.",
                 "Inventory counts and paths are independently checkable against JSON and optionally checkout.",
                 "A filename may hide server action/mutable operation; semantic scans required for completeness."],
    }
    (out/"GIT_TREE_ATTESTATION.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    return summary

def cli():
    pa=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    src=pa.add_mutually_exclusive_group(required=True)
    src.add_argument("--download",action="store_true",help="Descarga GitHub REST; solo lectura")
    src.add_argument("--tree-json",type=Path,help="Copia JSON íntegro de GitHub REST")
    pa.add_argument("--out",required=True,type=Path)
    pa.add_argument("--repo",type=Path,help="Checkout del SHA disponible para cotejo Git blobs")
    a=pa.parse_args()
    raw=read_rest() if a.download else a.tree_json.read_bytes()
    try:
        result=produce(raw,a.out.resolve(),a.repo)
    except Exception as err:
        print("ABORTADO: "+str(err),file=sys.stderr)
        sys.exit(2)
    print("ÁRBOL VALIDADO:",result["files"],"archivos,",result["directories"],
          "directorios, sha",result["tree_sha"])
    print("REVISADOS:",result["reviewed_files"]," TESTS EJECUTADOS:",result["executed_tests"])
    if not result["git_checkout_blobs_crosschecked"]:
        print("ADVERTENCIA: blobs del JSON aún no cotejados contra checkout Git local.")

if __name__=="__main__":
    cli()
