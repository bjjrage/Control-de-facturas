"""Compare schema-only catalog inventories. Never connects to production."""
import copy
import hashlib
import json
import pathlib
import sys

expected = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
actual = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8-sig"))
report = pathlib.Path(sys.argv[3])
details = []
material = []
counts = {}

def normalized(category, row):
    row = copy.deepcopy(row)
    if category == "columns":
        # pg_dump omits dropped columns: physical attnum holes do not survive.
        # Logical column ordering is checked separately below.
        row.pop("position", None)
    if category == "extensions":
        row.pop("version", None)
    return row

for category in expected:
    want = {x["key"]: x for x in expected[category]}
    got = {x["key"]: x for x in actual.get(category, [])}
    if len(want) != len(expected[category]) or len(got) != len(actual.get(category, [])):
        raise RuntimeError("Duplicate inventory keys: " + category)
    counts[category] = {"expected": len(want), "actual": len(got), "match": 0}
    for key in sorted(want.keys() | got.keys()):
        e, a = want.get(key), got.get(key)
        platform_default = category == "default_privileges" and key.startswith("supabase_admin:")
        if e is None:
            classification = "EXPECTED_PLATFORM_DIFFERENCE" if platform_default else "UNEXPECTED_IN_BASELINE"
        elif a is None:
            classification = "EXPECTED_PLATFORM_DIFFERENCE" if platform_default else "MISSING_FROM_BASELINE"
        elif normalized(category, e) == normalized(category, a):
            counts[category]["match"] += 1
            if e != a and category in ("columns", "extensions"):
                details.append({"category": category, "key": key, "classification": "EXPECTED_PLATFORM_DIFFERENCE", "expected": e, "actual": a})
            continue
        else:
            classification = "EXPECTED_PLATFORM_DIFFERENCE" if platform_default else "STRUCTURAL_MISMATCH"
        item = {"category": category, "key": key, "classification": classification, "expected": e, "actual": a}
        details.append(item)
        if classification != "EXPECTED_PLATFORM_DIFFERENCE":
            material.append(item)

def column_order(inventory):
    tables = {}
    for c in inventory["columns"]:
        table = c["key"].rsplit(".", 1)[0]
        tables.setdefault(table, []).append(c)
    return {k: [c["key"] for c in sorted(v, key=lambda x: x["position"])] for k, v in tables.items()}

if column_order(expected) != column_order(actual):
    material.append({"category": "columns", "classification": "STRUCTURAL_MISMATCH", "key": "logical column order"})

def fingerprint(inv):
    clean = {cat: sorted([normalized(cat, row) for row in rows], key=lambda x: x["key"]) for cat, rows in inv.items() if cat != "default_privileges"}
    return hashlib.sha256(json.dumps(clean, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

passed = not material
lines = ["# Baseline schema parity", "", "STRUCTURAL PARITY: " + ("PASS" if passed else "FAIL"),
         "", "Source: read-only production catalog snapshot; reconstructed target: ephemeral local Supabase on GitHub Actions.",
         "", "| Category | Production | Baseline | MATCH |", "| --- | ---: | ---: | ---: |"]
for cat, c in counts.items():
    lines.append(f'| {cat} | {c["expected"]} | {c["actual"]} | {c["match"]} |')
lines += ["", "## Differences", "",
          "Extension patch versions and dropped-column physical ordinal holes are expected platform differences; logical column order is checked. Supabase-managed default privileges for supabase_admin follow the platform's installation. Application object grants, RLS, policies and SECURITY DEFINER/INVOKER definitions must match.", "",
          "Material differences: " + str(len(material)), "",
          "Production structure fingerprint: " + fingerprint(expected),
          "Reconstructed structure fingerprint: " + fingerprint(actual), ""]
for d in details:
    lines.append(f'- {d["classification"]}: {d["category"]} / {d["key"]}')
if not details:
    lines.append("- MATCH: no differences.")
report.write_text("\n".join(lines) + "\n", encoding="utf-8")
report.with_suffix(".json").write_text(json.dumps({"pass": passed, "counts": counts, "differences": details, "material": material}, indent=2), encoding="utf-8")
print("STRUCTURAL PARITY:", "PASS" if passed else "FAIL", "| material differences:", len(material))
sys.exit(0 if passed else 1)

