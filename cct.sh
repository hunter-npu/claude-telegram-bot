#!/usr/bin/env bash
export CCT_WORK_DIR="$PWD"

# Parse -i / --instance flag
while [[ $# -gt 0 ]]; do
  case "$1" in
    -i|--instance)
      export CCT_INSTANCE="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

cd "$(dirname "$0")"
npx tsx --no-deprecation src/index.ts
