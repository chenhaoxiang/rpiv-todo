# Project guidance

Maintained standalone fork of juicesharp/rpiv-todo. Use isolated worktrees; preserve public `todo` identity, pure reducer invariants, branch replay and overlay lifecycle.

- `main` is our PR-managed integration/release branch; use regular merges.
- `upstream-main` exactly mirrors standalone community main; upstream remote is read-only/main-only. Do not replace this extension with rpiv-mono or install the mirror.
- Use the actual community base plus `-fork.<revision>`; publish every validated version with an immutable tag, GitHub Release, package, provenance and SHA-256 checksums. No upstream npm publication.
- Run `npm test` with synthetic task/branch/UI hosts and actual pinned TUI primitives, preserving characterization assertions. Verify package resources and isolated Pi startup without prompts/private session state; manual terminal acceptance remains distinct.

## Documentation map

- `docs/error-results.md`: explicit rejected-operation isError, historical error-snapshot rendering and actual returned task status regression.

- `docs/maintenance/2026-10-14-optimization-installed.md`: 0.1.2-fork.2 exact-source normal merge, CI, fresh-download checksums, installed bytes, combined loader and rollback/activation boundaries.

- `docs/task-readiness.md`: read-only readiness hints, dependency satisfaction, prioritized current-task overflow and reducer/lifecycle/view regression scope.

- `README.md` / `README.zh-CN.md`: English-first/full Chinese installation, reducer/persistence/overlay behavior and limits.
- `docs/releasing.md`: normalization, branches, per-version releases and verification boundaries.
