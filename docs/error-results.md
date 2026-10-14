---
doc_type: bug
project: workspace
status: active
truth_mode: maintained
created: 2026-10-14
verified: 2026-10-14
verified_by: manual
---

# Rejected task mutation results

The reducer already preserved state on invalid transitions but the tool omitted isError and its renderer preferred requested params.status over the returned snapshot. A completed-to-in_progress rejection therefore displayed in-progress while the task stayed completed. The tool now returns isError:true when reducer details.error exists. The renderer also recognizes historical details.error without that flag, and successful updates render only the returned task status. Reducer transitions, persisted snapshots, dependencies and successful result shape remain unchanged.

Six appended cases fail against pre-fix behavior and pass after the fix, covering illegal transitions, unknown IDs, empty create, legacy error snapshots and request/snapshot disagreement. Original12 cases stay unchanged; all18 pass with synthetic hosts and actual TUI primitives. No private task history/model or global configuration is used. Error flags report a rejected operation, not rollback of an external action.
