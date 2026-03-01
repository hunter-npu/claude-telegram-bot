#!/usr/bin/env bash
export CCT_WORK_DIR="$PWD"
cd "$(dirname "$0")"
npx tsx --no-deprecation src/index.ts
