---
doc_type: bug
project: workspace
status: active
truth_mode: maintained
created: 2026-10-14
verified: 2026-11-05
verified_by: source-synthetic-and-isolated-sdk
verification_scope: Native branch snapshot candidate, synthetic source regressions and explicit SDK codemode replay; release and installed acceptance remain separate
---

# Rejected task mutation results

The reducer already preserved state on invalid transitions but the tool omitted isError and its renderer preferred requested params.status over the returned snapshot. A completed-to-in_progress rejection therefore displayed in-progress while the task stayed completed. The tool now returns isError:true when reducer details.error exists. The renderer also recognizes historical details.error without that flag, and successful updates render only the returned task status. That repair left reducer transitions, then-existing snapshots, dependencies and successful result shape unchanged. The later native snapshot addition below retains those transition and dependency rules.

Six appended cases fail against pre-fix behavior and pass after the fix, covering illegal transitions, unknown IDs, empty create, legacy error snapshots and request/snapshot disagreement. Original12 cases stay unchanged; all18 pass with synthetic hosts and actual TUI primitives. No private task history/model or global configuration is used. Error flags report a rejected operation, not rollback of an external action.

## Native snapshot persistence (0.1.2-fork.4 candidate)

Composed calls such as codemode do not persist the nested tool result details. Todo now appends an owner-native `rpiv-todo-state` custom entry for each successful mutation and reads it on the current branch; this entry is not model context. Results add `stateSource: "native-entry-v1"`, so delayed direct-result projections cannot overwrite a newer checkpoint. Legacy unmarked direct snapshots remain readable. No task/state-machine/permission or codemode-text parser is added.

There are two additional storage failure outcomes. Missing append support or JSON serialization failure is rejected before mutation, with fixed diagnostics and no unsafe input echo. An exception from append after the mutation means persistence is unconfirmed: the new in-memory state and allocated IDs remain, any partial native entry remains, and no automatic rollback/replay occurs. `isError` in this case is not proof that the mutation was undone; a later restart can lose volatile-only state. Reads and reducer-rejected mutations do not append checkpoints.

Synthetic regressions cover nested create/update/next ID, branch isolation, clear/tombstones, old snapshots, delayed direct results, detached metadata and before/after-append failure. The optional `test/native-codemode-smoke.mjs` accepts explicit SDK, entry and isolated HOME paths. It uses actual SDK codemode/QuickJS and a synthetic stream (one SDK prompt, two synthetic rounds, zero provider requests), then reloads and reopens the native session file. Baseline fork.3 restores0 tasks after a successful nested create; the candidate restores1. This is bounded replay evidence, not live-user history migration or terminal acceptance.
