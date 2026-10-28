#!/usr/bin/env bash
# Print the SBPF version (ELF e_flags) of each program binary.
cd "$(dirname "${BASH_SOURCE[0]}")/.."
for f in target/deploy/imagine.so target/deploy/imagine-v0.so; do
  [ -f "$f" ] || continue
  flags=$(xxd -s 48 -l 4 -p "$f")
  printf '%-30s %8s bytes  e_flags=%s\n' "$f" "$(wc -c < "$f")" "$flags"
done
