---
doc_type: handoff
project: workspace
status: completed
truth_mode: snapshot
created: 2026-10-14
verified: 2026-10-14
verified_by: manual
---

# 0.1.2-fork.3 audited bugfix delivery

- Parent-only audit reproduced the concurrency/rejected-status/UI-interruption defect. The new regressions first failed against the old source; existing assertions and historical evidence remain unchanged. Feature PR [#7](https://github.com/chenhaoxiang/rpiv-todo/pull/7) normally merged at `48fb04317ae57cd1d02fd814082bcbd8c9b3f5e6` after parent native/source checks and the exact-head independent codex-local/deepseek-flash:high final review receipt was read and posted. Review is AI engineering evidence, not a second human approval.
- **18/18 local synthetic tests pass**. Exact-source main CI [38524898145](https://github.com/chenhaoxiang/rpiv-todo/actions/runs/38524898145) succeeded. Both original/current Subagents source pins also passed for Notify. Source/local/native-synthetic/CI and actual platform delivery remain distinct.
- Immutable [v0.1.2-fork.3](https://github.com/chenhaoxiang/rpiv-todo/releases/tag/v0.1.2-fork.3) attaches exactly the tarball, schema1 original release-manifest.json and SHA256SUMS. Fresh download verified both entries and current Pi1.2 isolated RPC registration. Package SHA256 `0183b5194588f5986bd76df2a3ff9e7fb56aeaa61675a1a2c6906ce396faebe8`; original manifest SHA256 `10bb2d762b750abf53279da3dc6b85652665e5ac7fe3fed3bb954461ecdfe1de`. Unlike the previous release, no metadata projection/supplement is needed.
- Permanent install `/Users/robotmac/.pi/agent/packages/rpiv-todo/0.1.2-fork.3`: **9 shipped files** match the freshly downloaded package byte-for-byte. Installed RPC passes. This batch replaces exactly three package sources; unrelated settings and pi-better-compaction0.7.4-fork.2 are unchanged, old versions retained, forced restarts0.
- Parent reran actual installed source: real Pi1.2 extension-tool wrapper/default-parallel Agent scheduler + native custom-UI lifecycle with four synthetic responses returned both question answers in order and propagated Todo isError while retaining completed state. Notify installed source resumed the interrupted settle exactly once under virtual timers/FS/OS transport; zero real notifications. Four-package normal loader/fresh AgentSession additionally reports zero load errors/messages/model calls. These do not prove live terminal/IME, all ambient plugins, real model/billing or macOS delivery.
- Owner-only backup/rollback receipt `~/.pi/agent/backups/three-extension-bugfix-20261014/`; rollback not exercised. New sessions adopt disk changes; busy or opaque-dependent sessions were not forced to reload. This docs-only handoff changes no shipped code or immutable asset.
