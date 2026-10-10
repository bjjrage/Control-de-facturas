#!/usr/bin/env python3
"""Synthetic safety tests of bootstrap tooling, NEVER tests of the ERP."""
import csv
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import runner_gate
import baseline_from_github_tree
import safe_log
import npm_lock_guard
import evidence_manifest
import source_signal_inventory

class BootstrapGuards(unittest.TestCase):
    def test_rest_tree_url_uses_tree_object_not_commit(self):
        self.assertTrue(baseline_from_github_tree.API_URL.endswith(
            f"/git/trees/{baseline_from_github_tree.EXPECTED_TREE}?recursive=1"))
        self.assertNotIn(baseline_from_github_tree.FROZEN_COMMIT, baseline_from_github_tree.API_URL)
    def test_loopback_strict(self):
        result=runner_gate.assert_local_url(
            "postgresql://postgres:postgres@127.0.0.1:54322/postgres","local",54322)
        self.assertEqual(result["port"],54322)
        for url in ("postgresql://postgres@evil.example:54322/db",
                    "postgresql://postgres@127.0.0.1:5432/db",
                    "postgresql://postgres@127.0.0.1:54323/db",
                    "postgresql://postgres@172.17.0.1:54322/db"):
            with self.subTest(url=url),self.assertRaises(RuntimeError):
                runner_gate.assert_local_url(url,"db",54322)
    def test_context_rejects_wrong_branch(self):
        with mock.patch.dict(os.environ, {
             "GITHUB_ACTIONS":"true", "RUNNER_OS":"Linux",
             "GITHUB_REPOSITORY":"bjjrage/Control-de-facturas",
             "GITHUB_REF":"refs/heads/main", "GITHUB_EVENT_NAME":"push"},clear=True):
            with self.assertRaisesRegex(RuntimeError,"GITHUB_REF"):
                runner_gate.check_context()
    def test_context_accepts_only_bootstrap_branch(self):
        with mock.patch.dict(os.environ, {
             "GITHUB_ACTIONS":"true", "RUNNER_OS":"Linux",
             "GITHUB_REPOSITORY":"bjjrage/Control-de-facturas",
             "GITHUB_REF":"refs/heads/audit/engineering-v3-bootstrap",
             "GITHUB_EVENT_NAME":"push"},clear=True):
            self.assertTrue(runner_gate.check_context())
    def test_repo_env_rejects_production_key(self):
        with tempfile.TemporaryDirectory() as d:
            source=Path(d)
            with mock.patch.dict(os.environ,{"DATABASE_URL":"postgresql://prod.example/db"},clear=True):
                with self.assertRaisesRegex(RuntimeError,"DATABASE_URL"):
                    runner_gate.assert_no_production_context(source)
    def test_repo_env_rejects_linked_project(self):
        with tempfile.TemporaryDirectory() as d:
            source=Path(d)
            subprocess.run(["git","init","-q",str(source)],check=True)
            (source/"supabase/.temp").mkdir(parents=True)
            (source/"supabase/.temp/project-ref").write_text("production-project")
            with mock.patch.dict(os.environ,{},clear=True):
                with self.assertRaisesRegex(RuntimeError,"project-ref"):
                    runner_gate.assert_no_production_context(source)
    def test_reject_unapproved_npm_download_host(self):
        with tempfile.TemporaryDirectory() as d:
            folder=Path(d)
            lock=folder/"package-lock.json"
            report=folder/"preflight.json"
            lock.write_text(json.dumps({"lockfileVersion":3,"packages":{
                "":{},"node_modules/unsafe":{"resolved":"https://prod.example/unsafe.tgz","integrity":"sha512-test"}}}))
            with self.assertRaisesRegex(RuntimeError,"disallowed"):
                npm_lock_guard.check(lock,report)
            self.assertEqual(json.loads(report.read_text())["result"],"FAIL")
    def test_allow_only_expected_npm_download_hosts(self):
        with tempfile.TemporaryDirectory() as d:
            folder=Path(d)
            lock=folder/"package-lock.json"
            report=folder/"preflight.json"
            lock.write_text(json.dumps({"lockfileVersion":3,"packages":{
                "":{},"node_modules/good":{"resolved":"https://registry.npmjs.org/pkg/-/pkg-1.tgz","integrity":"sha512-test"}}}))
            self.assertEqual(npm_lock_guard.check(lock,report)["result"],"PASS")
    def test_secret_line_dropped(self):
        with tempfile.TemporaryDirectory() as d:
            a=Path(d)/"in.log"
            b=Path(d)/"out.log"
            a.write_text("safe line\nDB_URL=postgresql://prod.example/db\nsafe ending")
            safe_log.redact(a,b)
            out=b.read_text()
            self.assertIn("safe line",out)
            self.assertIn("[REDACTED",out)
            self.assertNotIn("prod.example",out)
    def test_manifest_cannot_claim_pass_without_evidence(self):
        with tempfile.TemporaryDirectory() as d:
            import contextlib,io
            with contextlib.redirect_stdout(io.StringIO()):
                result=evidence_manifest.write(Path(d),"bjjrage/Control-de-facturas","123")
            self.assertEqual(result["runner_bootstrap_capacity"],"INCOMPLETE")
            self.assertEqual(result["executed_erp_tests"],0)
            self.assertGreater(len(result["blockers"]),0)
    def test_baseline_source_pin_constant(self):
        self.assertEqual(runner_gate.SHA,"953ebba505b38313bd3e18e6cb9fbf31b7e1eb89")
        self.assertEqual(runner_gate.TREE,"a91c8c54dd9d80b7f63a86015eff2e516b21b98f")
    def test_no_remote_db_reset_in_schema_script(self):
        p=Path(__file__).resolve().parents[1]/"local_schema_capacity.py"
        content=p.read_text()
        self.assertIn('["supabase","db","reset","--local","--no-seed"]',content)
        self.assertNotIn('["supabase","db","reset","--linked"',content)
        self.assertIn('assert_local_url',content)
    def test_end_to_end_inventory_signals_synthetic(self):
        with tempfile.TemporaryDirectory() as d:
            tmp=Path(d)
            repo=tmp/"repo"
            out=tmp/"evidence"
            repo.mkdir()
            subprocess.run(["git","init","-q",str(repo)],check=True)
            files={
                "package.json":'{"scripts":{"test":"vitest run","e2e:seed":"tsx script.ts"}}',
                "app/api/records/route.ts":'export async function POST(req) { return db.rpc("create"); }',
                "app/page.tsx":"export default function Home() {}",
                "tests/foo.spec.ts":'test.skip("should work", () => { expect(true).toBe(true); });',
                "vitest.config.mts":'export default {test:{exclude:["**/external/**"]}};',
                "supabase/migrations/20261010123456_init.sql":"CREATE TABLE audit_fixture (id int);",
                "worker/index.ts":'const work=() => db.update({});',
            }
            for i in range(1584-len(files)):
                files[f"filler/file-{i:04d}.txt"]="not code\n"
            for rel,content in files.items():
                p=repo/rel
                p.parent.mkdir(parents=True,exist_ok=True)
                p.write_text(content)
            subprocess.run(["git","-C",str(repo),"add","."],check=True)
            inv=tmp/"INVENTORY.csv"
            with inv.open("w",newline="",encoding="utf-8") as f:
                w=csv.DictWriter(f,fieldnames=["path","blob_sha","size_bytes"])
                w.writeheader()
                for name in files:
                    w.writerow({"path":name,"blob_sha":"0"*40,"size_bytes":len(files[name].encode())})
            result=source_signal_inventory.scan(repo,out,inv)
            self.assertEqual(result["files_from_git"],1584)
            self.assertGreater(result["mutable_code_signals"],0)
            self.assertGreater(result["test_candidate_files"],0)
            self.assertGreater(result["skip_todo_only_signal_rows"],0)
            with (out/"SOURCE_ENTRYPOINT_SIGNALS.csv").open(newline="",encoding="utf-8") as f:
                paths=set(r["path"] for r in csv.DictReader(f))
            self.assertIn("app/page.tsx",paths)
            self.assertIn("app/api/records/route.ts",paths)
            self.assertEqual(result["coverage_status"],
                             "E0_EVIDENCE_ONLY; ZERO FILES CREDITED AS AUDITED")

if __name__=="__main__":
    unittest.main()
