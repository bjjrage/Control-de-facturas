#!/usr/bin/env bash

if [ "${VERCEL_GIT_COMMIT_REF:-}" = "main" ]; then
  echo "main detected: proceed with production build"
  exit 1
fi

echo "non-main branch detected: skip deployment"
exit 0
