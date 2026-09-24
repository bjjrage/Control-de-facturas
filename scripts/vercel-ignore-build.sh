#!/usr/bin/env bash

ref="${VERCEL_GIT_COMMIT_REF:-}"

case "$ref" in
preview/*)
echo "preview branch detected: proceed with build"
exit 1
;;
esac

echo "non-preview branch: skip deployment"
exit 0
