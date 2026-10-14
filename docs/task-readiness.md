---
doc_type: guide
project: workspace
status: active
truth_mode: maintained
created: 2026-10-14
verified: 2026-10-14
---

# Task readiness and regression contract

0.1.2-fork.2 preserves the standalone community base, public todo identity, pure reducer, four-state transitions and tool-result branch snapshots. Six characterization cases were run against unchanged source before edits and remain unchanged. Actual Pi TUI 1.2.0 primitives and synthetic hosts exercise reducers, lifecycle replay and overlays without a model/global settings/private sessions. New tests cover readiness, deleted/missing dependencies, slash commands, next-ID replay at compaction/tree boundaries and overflow.

`/todos ready` reports pending tasks whose dependencies are all completed. Deleted/missing dependencies remain unresolved; status deletion does not mean successful completion. List and widget hints distinguish ready tasks and exact unresolved IDs. Ready is informational: no tool execution, state transition or scheduling occurs. The widget preserves insertion order, hides completed rows first and prioritizes in-progress rows when the active list exceeds the twelve-line limit. No new persistence/database is introduced; current-branch snapshots remain the only task state source.

Local suite: 11 tests pass, including all16 transition pairs and the pre-edit characterization cases. CI uses the same provider-free suite. Package startup is separately checked. Synthetic rendering is not proof of every terminal/IME behavior, a task marked complete is not evidence of external success, and source/merge/release/installation must be recorded separately.
