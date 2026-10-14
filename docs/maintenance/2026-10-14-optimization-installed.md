---
doc_type: handoff
project: workspace
status: completed
truth_mode: snapshot
created: 2026-10-14
verified: 2026-10-14
verified_by: manual
---

# 0.1.2-fork.2 release and installed acceptance

- Feature/source PR [#5](https://github.com/chenhaoxiang/rpiv-todo/pull/5) merged normally at `31875476dbbeb3806d7ec634b4cb752e57c4b627`; exact-head independent codex-local/deepseek-flash:high initial/fix review records and hashes are in that PR. Original findings remain preserved; all P0/P1 resolved. AI engineering review is not a second human approval.
- Local merged-source provider-free suite: **12/12 pass**. Exact-main hosted CI [38507886514](https://github.com/chenhaoxiang/rpiv-todo/actions/runs/38507886514) succeeded. Fixtures use synthetic models/empty auth, not personal credentials/history. Compaction alone additionally has strict OpenSpec and 92/92 measured added runtime lines; no branch metric or legacy strict-tsc success is asserted.
- Immutable [Release v0.1.2-fork.2](https://github.com/chenhaoxiang/rpiv-todo/releases/tag/v0.1.2-fork.2) is built from that exact clean source with tarball, release-manifest.json and SHA256SUMS. Fresh download verified both checksum entries and passed current Pi1.2.0-fork.1 isolated package/RPC loading. Package SHA256: `09fe7a6594eb31549c3dade9bece07a3b40be67468f44e2042743042fc30642d`. Earlier scratch packs/logs are not release provenance.
- Installed permanent path: `/Users/robotmac/.pi/agent/packages/rpiv-todo/0.1.2-fork.2`. All **8 shipped files** read back byte-for-byte against the downloaded package; the source-bound manifest is retained beside them. Installed-path RPC loading passed without a model prompt.
- Exactly four package source declarations (Notify, Ask, Todo, Compaction) changed together; unrelated settings structurally unchanged, old fixed installations/Git caches preserved, forced restarts **0**. An isolated normal DefaultResourceLoader/fresh AgentSession on installed Pi1.2 loaded four packages with zero load errors/messages/model calls and exposed todo/ask_user_question. This does not exhaust every ambient extension or prove old sessions hot-loaded.
- Owner-only rollback snapshot/receipt: `~/.pi/agent/backups/four-extension-optimization-20261014/`. Rollback not exercised; not a promise that opaque-dependent sessions can safely downgrade. Finish current work before restarting to adopt installed code; never force-unload compaction while relying on an opaque checkpoint.
- No real provider compaction/billing or macOS notification/sound/terminal/IME acceptance performed. Readiness is observation, not business success, authorization or a complete bill. Source, merge, Release, installed bytes and running-session activation are separate facts. This docs-only handoff does not alter or republish immutable assets.
