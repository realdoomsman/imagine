#!/usr/bin/env bash
# Print the SBPF version (ELF e_flags) of each program binary.
cd /mnt/c/tech/Hold
for f in target/deploy/vise.so target/deploy/vise-v0.so; do
  [ -f "$f" ] || continue
  flags=$(xxd -s 48 -l 4 -p "$f")
  printf '%-28s %8s bytes  e_flags=%s\n' "$f" "$(wc -c < "$f")" "$flags"
done
ls -la target/sbpf-solana-solana/release/*.so target/sbf-solana-solana/release/*.so 2>/dev/null
