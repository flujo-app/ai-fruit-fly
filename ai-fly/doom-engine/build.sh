#!/usr/bin/env bash
# Builds ai-fly/data/doom/doom.wasm from src/ with Emscripten inside Docker.
#
#   cd ai-fly/doom-engine && ./build.sh
#
# Needs only Docker (Linux containers). Works from Git Bash on Windows (MSYS path
# conversion is switched off and the folder is mounted by its Windows path), and
# from Linux/macOS shells. The image already holds every library emcc needs, so
# nothing is downloaded or cached outside the image. Takes about 10 seconds.
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="emscripten/emsdk:4.0.10"   # pinned
ROOT="$(cd .. && (pwd -W 2>/dev/null || pwd))"   # the ai-fly folder
mkdir -p ../data/doom

# Linux/macOS: hand the output back to the calling user afterwards (emcc runs as the
# image's root user). Docker Desktop on Windows needs nothing.
OWNER=""
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *) OWNER="$(id -u):$(id -g)" ;;
esac

EXPORTS='["_fg_wad_alloc","_fg_init","_fg_new_game","_fg_set_player","_fg_give","_fg_set_cmd","_fg_tick","_fg_render","_fg_render_full","_fg_palettes","_fg_state","_fg_state_count","_fg_spawn","_fg_things","_fg_sounds","_fg_ints","_fg_set_fill","_fg_mem_info"]'

CFLAGS=(
  -O3 -std=gnu99 -DFLYGYM
  -fwrapv -fno-strict-aliasing      # Doom relies on wrap-around and type punning
  -ftrivial-auto-var-init=zero      # no stale stack contents can leak into a game
  -Wno-unused-result -Wno-parentheses -Wno-dangling-else -Wno-pointer-sign
  -Wno-incompatible-pointer-types-discards-qualifiers -Wno-string-plus-int
  -Wno-deprecated-non-prototype -Wno-absolute-value -Wno-switch
  -Wno-tautological-constant-out-of-range-compare -Wno-unused-value
)
LDFLAGS=(
  -sSTANDALONE_WASM=1 --no-entry    # plain .wasm, tiny WASI-style import set
  -sINITIAL_MEMORY=16MB -sALLOW_MEMORY_GROWTH=0
  -sSTACK_SIZE=1MB
  -sEXPORTED_FUNCTIONS="$EXPORTS"
  -sERROR_ON_UNDEFINED_SYMBOLS=1
)

MSYS_NO_PATHCONV=1 docker run --rm -e OWNER="$OWNER" \
  -v "$ROOT:/work" -w /work/doom-engine \
  "$IMAGE" \
  sh -c 'emcc "$@" && if [ -n "$OWNER" ]; then chown "$OWNER" /work/data/doom/doom.wasm; fi' emcc \
  "${CFLAGS[@]}" src/*.c "${LDFLAGS[@]}" -o /work/data/doom/doom.wasm

ls -l ../data/doom/doom.wasm
