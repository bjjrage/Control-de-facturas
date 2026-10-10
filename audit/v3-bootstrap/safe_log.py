#!/usr/bin/env python3
"""Redact untrusted output before publication; raw output stays in ephemeral RUNNER_TEMP."""
import argparse
from pathlib import Path
import re

SENSITIVE=re.compile(r"(?i)(?:secret|token|password|api.key|service.role|anon.key|jwt|"
                     r"authorization|bearer|postgres(?:ql)?://|://\S+:\S+@|"
                     r"SUPABASE_|eyJ[a-z0-9_-]{12}|NPM_TOKEN)")
def redact(src:Path,dest:Path):
    count=0
    with src.open(encoding="utf-8",errors="replace") as inp, dest.open("w",encoding="utf-8") as out:
        for line in inp:
            count+=1
            if count>3000:
                out.write("[TRUNCATED; raw ephemeral log not attached]\n")
                break
            out.write("[REDACTED SENSITIVE LINE]\n" if SENSITIVE.search(line) else line[:650]+"\n")
if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("src",type=Path)
    ap.add_argument("dest",type=Path)
    opts=ap.parse_args()
    redact(opts.src,opts.dest)
