# Project guidance

Maintained standalone fork of juicesharp/rpiv-todo. Use isolated worktrees; preserve public `todo` identity, pure reducer invariants, branch replay and overlay lifecycle.

- `main` is our PR-managed integration/release branch; use regular merges.
- `upstream-main` exactly mirrors standalone community main; upstream remote is read-only/main-only. Do not replace this extension with rpiv-mono or install the mirror.
- Use the actual community base plus `-fork.<revision>`; publish every validated version with an immutable tag, GitHub Release, package, provenance and SHA-256 checksums. No upstream npm publication.
- No automated functional suite is currently configured. Verify package resources and isolated Pi startup without model prompts or private session state; manual overlay acceptance remains distinct.

## Documentation map

- `README.md` / `README.zh-CN.md`: English-first/full Chinese installation, reducer/persistence/overlay behavior and limits.
- `docs/releasing.md`: normalization, branches, per-version releases and verification boundaries.
