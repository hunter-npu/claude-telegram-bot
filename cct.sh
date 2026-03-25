#!/usr/bin/env bash
export CCT_WORK_DIR="$PWD"

# Parse --env / -e and --config / -c flags (paths resolved relative to cwd before cd)
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env|-e)
      export CCT_ENV_FILE="$(realpath "$2")"
      shift 2
      ;;
    --config|-c)
      export CCT_CONFIG_FILE="$(realpath "$2")"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

cd "$(dirname "$0")"
npx tsx --no-deprecation src/index.ts
