#!/bin/bash
cd "$(dirname "$0")"
for a in none valibot typebox ata ata-aot zod; do
  best_ms=99999; rss_at_best=0
  for run in 1 2 3 4 5 6 7; do
    out=$(bun run src/serve-$a.ts 2>/dev/null | head -1)
    [ -z "$out" ] && continue
    ms=$(printf '%s' "$out" | sed -n 's/.*"ready_ms":\([0-9.]*\).*/\1/p')
    rss=$(printf '%s' "$out" | sed -n 's/.*"rss":\([0-9]*\).*/\1/p')
    [ -z "$ms" ] && continue
    if awk "BEGIN{exit !($ms < $best_ms)}"; then best_ms=$ms; rss_at_best=$rss; fi
  done
  printf "%-10s startup %7.1f ms   RSS %3d MB\n" "$a" "$best_ms" "$((rss_at_best/1048576))"
done
