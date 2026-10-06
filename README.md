# rpiv-todo — maintained fork

English | [中文](README.zh-CN.md)

A Pi extension that provides a Claude-Code-style `todo` tool, the `/todos` command, and a persistent todo overlay above the editor.

This repository is the maintained fork:

<https://github.com/chenhaoxiang/rpiv-todo>

## Releases and branch policy

The maintained release is **0.1.2-fork.1**, based on community **0.1.2**. Fork releases use `<community-version>-fork.<revision>`; the fork revision increases without pretending to be a new upstream release.

- `main`: our maintained integration and release branch, including fork fixes.
- `upstream-main`: an exact mirror of the community's `main`, with no fork commits. Never install from this branch.
- Changes enter `main` through reviewed pull requests; existing branches and history are retained.

Install a reproducible release:

```bash
pi install git:github.com/chenhaoxiang/rpiv-todo@v0.1.2-fork.1
```

[GitHub Releases](https://github.com/chenhaoxiang/rpiv-todo/releases) include the installable package tarball, a provenance manifest, and `SHA256SUMS`. These GitHub releases are not npm publications under the upstream author's namespace. See [release maintenance](docs/releasing.md) for asset installation and future releases.

The earlier unqualified fork version `0.1.4` is standardized as `0.1.2-fork.1` using its real community base, not by reverting host-import or overlay behavior.

## Install this fork

```bash
pi install git:github.com/chenhaoxiang/rpiv-todo@main
```

The upstream npm package and this fork are separate sources. Pin a reviewed commit when reproducibility matters:

```bash
pi install git:github.com/chenhaoxiang/rpiv-todo@<reviewed-commit>
```

Restart Pi or run `/reload` after installation.

## Tool and command

The extension registers:

- **`todo`** — create, update, list, inspect, delete, or clear tasks;
- **`/todos`** — print the current non-deleted task list grouped by status;
- **`rpiv-todos` widget** — a persistent above-editor view that refreshes as tasks change.

Example tool calls:

```ts
todo({ action: "create", subject: "Review the API diff", activeForm: "reviewing the API diff" })
todo({ action: "update", id: 1, status: "in_progress" })
todo({ action: "list" })
todo({ action: "get", id: 1 })
todo({ action: "update", id: 1, status: "completed" })
```

Tasks have four states:

```text
pending → in_progress → completed
    └───────────────┘
any live state → deleted
```

Completed tasks cannot be reopened. Invalid transitions return a structured error instead of mutating state.

## Dependencies and task ownership

Tasks can depend on other tasks through `blockedBy`:

```ts
todo({
  action: "create",
  subject: "Run integration tests",
  blockedBy: [1]
})
```

The reducer rejects:

- missing or deleted dependency IDs;
- self-dependencies;
- cycles in the dependency graph;
- updates without a mutable field;
- invalid status transitions.

Optional fields include `description`, `activeForm`, `owner`, and arbitrary `metadata`. Metadata updates merge by key; a `null` value removes a key.

## Persistence and overlay behavior

Todo state is persisted through the tool result details recorded in Pi's session branch. On `session_start`, compaction, and tree changes, the extension reconstructs the latest snapshot from the current branch. Existing session history therefore survives `/reload`, compaction, and branch navigation.

The overlay:

- appears above the editor when at least one non-deleted task exists;
- displays status glyphs, active forms, IDs, and dependency links when useful;
- collapses to 12 lines when the list is long;
- drops completed rows before active work when space is limited;
- unregisters itself when no visible tasks remain;
- rebinds safely after `/reload` or a UI-context change.

The widget reads live module state while rendering. It does not reconstruct branch state from a stale `tool_execution_end` snapshot.

## Compatibility and limits

- Uses Pi's host-provided `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox` packages.
- The public tool identity is deliberately `todo`; do not rename it if existing permission rules and session history must remain compatible.
- State is local to Pi session history. This extension is not a cross-session task database and does not synchronize tasks between machines.
- `/todos` requires interactive mode; the tool itself remains usable where Pi can return structured tool results.

## Development

There is currently no automated functional test script. Release checks inspect package resources and isolated current-Pi RPC startup, not live overlay acceptance. The package is loaded as TypeScript through Pi's package loader:

```bash
npm install --ignore-scripts
```

Use disposable sessions and temporary Pi directories for checks. Verify create/update/blockedBy/cycle/state-replay behavior and the overlay's empty, normal, and overflow states. Do not use private production session history as test data.

## License

MIT
