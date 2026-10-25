# Under Bun's ahead-of-time compiler

`bench.ts`: the module from `ata build`, ata's runtime Validator and zod 4 on
the same 1024 parsed documents, in process, printing nanoseconds per
document. Built twice by one bun, `--compile` (JIT) and `--compile --aot`.
`server.ts` and `measure.mjs` are the HTTP version (start-up only: one
sequential connection saturates every route at the same rate).

The compiler is an open pull request (oven-sh/bun#45631); its CI build
installs with `bunx bun-pr 45631`. From `benchmark/proof`:

    npm install && npm run build
    cd aot && npm install
    BUN=~/.bun/bin/bun-45631
    $BUN build --compile ./bench.ts --outfile ./bench-jit && ./bench-jit
    $BUN build --compile --aot ./bench.ts --outfile ./bench-aot && ./bench-aot
    $BUN build --compile --aot --explain ./bench.ts --outfile ./bench-aot

RESULTS.md has the run of 2026-10-25. `--aot` makes TypeScript errors fatal,
so the files type-check against ata's declarations.
