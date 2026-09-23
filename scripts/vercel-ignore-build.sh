#!/usr/bin/env bash

ref="${VERCEL_GIT_COMMIT_REF:-}"

if [ "$ref" = "main" ]; then
  echo "main detected: proceed with production build"
  exit 1
fi

case "$ref" in
  preview/*)
    echo "preview branch detected: proceed with preview build"
    exit 1
    ;;
  recovery/erp-functional-rebuild)
    echo "authorized recovery branch detected: proceed with preview build"
    exit 1
    ;;
esac

echo "branch '$ref' is not main, preview/*, or the authorized recovery branch: skip deployment"
exit 0
