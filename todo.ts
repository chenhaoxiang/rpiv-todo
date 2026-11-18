/**
 * todo tool + /todos command — Claude-Code-parity Task management.
 *
 * State lives in this module. Mutations append owner snapshots through Pi's
 * native custom-entry API so composed calls also survive branch reconstruction.
 * Direct AgentToolResult.details snapshots remain readable for older histories.
 * reconstructTodoState walks only the current branch; applyTaskMutation owns
 * truth for invariants — state machine transitions, blockedBy cycle checks,
 * dangling-reference rejection. Tool name is deliberately "todo" (not
 * TaskCreate/etc.) to preserve the permissions entry at
 * templates/pi-permissions.jsonc:26.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Constants — tool/command identity and static user-facing strings
// ---------------------------------------------------------------------------

export const TOOL_NAME = "todo";
export const TODO_STATE_ENTRY = "rpiv-todo-state";
const TOOL_LABEL = "Todo";
const COMMAND_NAME = "todos";

const ERR_UNKNOWN_SESSION = "Todo unavailable: session ID could not be determined.";
const ERR_REQUIRES_INTERACTIVE = "/todos requires interactive mode";
const MSG_NO_TODOS = "No todos yet. Ask the agent to add some!";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";

export type TaskAction = "create" | "update" | "list" | "get" | "delete" | "clear";

export interface Task {
	id: number;
	subject: string;
	description?: string;
	activeForm?: string;
	status: TaskStatus;
	blockedBy?: number[];
	owner?: string;
	metadata?: Record<string, unknown>;
}

export interface TaskDetails {
	action: TaskAction;
	params: Record<string, unknown>;
	tasks: Task[];
	nextId: number;
	/** This result is a projection, not a replay source or a durable-write receipt. */
	stateSource?: "native-entry-v1";
	error?: string;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
	pending: new Set(["in_progress", "completed", "deleted"]),
	in_progress: new Set(["pending", "completed", "deleted"]),
	completed: new Set(["deleted"]),
	deleted: new Set(),
};

// ---------------------------------------------------------------------------
// Module state — partitioned by Pi session identity
// ---------------------------------------------------------------------------

const sessionStates = new Map<string, ReducerState>();

type SessionContext = Pick<ExtensionContext, "sessionManager">;

function getSessionManager(ctx?: SessionContext): SessionContext["sessionManager"] | undefined {
	try {
		return ctx?.sessionManager;
	} catch (error) {
		// Pi invalidates old contexts on session replacement and reload.
		if (/stale after session replacement/.test(String(error))) return undefined;
		throw error;
	}
}

function getSessionId(manager?: SessionContext["sessionManager"]): string | undefined {
	if (typeof manager?.getSessionId !== "function") return undefined;
	const id = manager.getSessionId();
	return typeof id === "string" && id.trim() ? id : undefined;
}

export function getTodoSessionId(ctx?: SessionContext): string | undefined {
	return getSessionId(getSessionManager(ctx));
}

function emptyState(): ReducerState {
	return { tasks: [], nextId: 1 };
}

function getState(sessionId: string | undefined): ReducerState {
	return (sessionId !== undefined ? sessionStates.get(sessionId) : undefined) ?? emptyState();
}

export function getTodos(sessionId: string | undefined): readonly Task[] {
	return getState(sessionId).tasks;
}

export function evictTodoState(sessionId: string): void {
	sessionStates.delete(sessionId);
}

// ---------------------------------------------------------------------------
// Pure helpers — no state mutation, no I/O
// ---------------------------------------------------------------------------

export function isTransitionValid(from: TaskStatus, to: TaskStatus): boolean {
	if (from === to) return true;
	return VALID_TRANSITIONS[from].has(to);
}

export function detectCycle(
	taskList: readonly Task[],
	taskId: number,
	newBlockedBy: readonly number[],
): boolean {
	const edges = new Map<number, number[]>();
	for (const t of taskList) {
		if (t.id === taskId) {
			const merged = new Set([...(t.blockedBy ?? []), ...newBlockedBy]);
			edges.set(t.id, [...merged]);
		} else {
			edges.set(t.id, t.blockedBy ? [...t.blockedBy] : []);
		}
	}

	const visiting = new Set<number>();
	const visited = new Set<number>();
	const hasCycleFrom = (node: number): boolean => {
		if (visiting.has(node)) return true;
		if (visited.has(node)) return false;
		visiting.add(node);
		for (const nb of edges.get(node) ?? []) {
			if (hasCycleFrom(nb)) return true;
		}
		visiting.delete(node);
		visited.add(node);
		return false;
	};

	for (const node of edges.keys()) {
		if (hasCycleFrom(node)) return true;
	}
	return false;
}

export function deriveBlocks(taskList: readonly Task[]): Map<number, number[]> {
	const blocks = new Map<number, number[]>();
	for (const t of taskList) {
		for (const dep of t.blockedBy ?? []) {
			const arr = blocks.get(dep) ?? [];
			arr.push(t.id);
			blocks.set(dep, arr);
		}
	}
	return blocks;
}

/** Missing/deleted dependencies remain unresolved; only completed satisfies a dependency. */
export function unresolvedDependencies(task: Task, taskList: readonly Task[]): number[] {
	return (task.blockedBy ?? []).filter(id => taskList.find(t => t.id === id)?.status !== "completed");
}

export function readyTasks(taskList: readonly Task[]): Task[] {
	return taskList.filter(t => t.status === "pending" && unresolvedDependencies(t, taskList).length === 0);
}

// ---------------------------------------------------------------------------
// Reducer — pure, single source of truth for invariants
// ---------------------------------------------------------------------------

interface ReducerState {
	tasks: Task[];
	nextId: number;
}

interface ReducerResult {
	state: ReducerState;
	details: TaskDetails;
	content: Array<{ type: "text"; text: string }>;
}

interface TaskMutationParams {
	[key: string]: unknown;
	subject?: string;
	description?: string;
	activeForm?: string;
	status?: TaskStatus;
	blockedBy?: number[];
	addBlockedBy?: number[];
	removeBlockedBy?: number[];
	owner?: string;
	metadata?: Record<string, unknown>;
	id?: number;
	includeDeleted?: boolean;
}

function errorResult(
	state: ReducerState,
	action: TaskAction,
	params: TaskMutationParams,
	error: string,
): ReducerResult {
	return {
		state,
		details: {
			action,
			params: params as Record<string, unknown>,
			tasks: state.tasks,
			nextId: state.nextId,
			error,
		},
		content: [{ type: "text", text: `Error: ${error}` }],
	};
}

export function applyTaskMutation(
	state: ReducerState,
	action: TaskAction,
	params: TaskMutationParams,
): ReducerResult {
	switch (action) {
		case "create": {
			if (!params.subject || !params.subject.trim()) {
				return errorResult(state, action, params, "subject required for create");
			}
			if (params.blockedBy && params.blockedBy.length) {
				for (const dep of params.blockedBy) {
					const depTask = state.tasks.find((t) => t.id === dep);
					if (!depTask) {
						return errorResult(
							state,
							action,
							params,
							`blockedBy: #${dep} not found`,
						);
					}
					if (depTask.status === "deleted") {
						return errorResult(
							state,
							action,
							params,
							`blockedBy: #${dep} is deleted`,
						);
					}
				}
			}
			const newTask: Task = {
				id: state.nextId,
				subject: params.subject,
				status: "pending",
			};
			if (params.description) newTask.description = params.description;
			if (params.activeForm) newTask.activeForm = params.activeForm;
			if (params.blockedBy && params.blockedBy.length) {
				newTask.blockedBy = [...params.blockedBy];
			}
			if (params.owner) newTask.owner = params.owner;
			if (params.metadata) newTask.metadata = { ...params.metadata };

			const newTasks = [...state.tasks, newTask];
			const newState: ReducerState = { tasks: newTasks, nextId: state.nextId + 1 };
			return {
				state: newState,
				details: {
					action: "create",
					params: params as Record<string, unknown>,
					tasks: newTasks,
					nextId: newState.nextId,
				},
				content: [
					{
						type: "text",
						text: `Created #${newTask.id}: ${newTask.subject} (pending)`,
					},
				],
			};
		}

		case "update": {
			if (params.id === undefined) {
				return errorResult(state, action, params, "id required for update");
			}
			const idx = state.tasks.findIndex((t) => t.id === params.id);
			if (idx === -1) {
				return errorResult(state, action, params, `#${params.id} not found`);
			}
			const current = state.tasks[idx];

			const hasMutation =
				params.subject !== undefined ||
				params.description !== undefined ||
				params.activeForm !== undefined ||
				params.status !== undefined ||
				params.owner !== undefined ||
				params.metadata !== undefined ||
				(params.addBlockedBy && params.addBlockedBy.length > 0) ||
				(params.removeBlockedBy && params.removeBlockedBy.length > 0);
			if (!hasMutation) {
				return errorResult(
					state,
					action,
					params,
					"update requires at least one mutable field",
				);
			}

			let newStatus = current.status;
			if (params.status !== undefined) {
				if (!isTransitionValid(current.status, params.status)) {
					return errorResult(
						state,
						action,
						params,
						`illegal transition ${current.status} → ${params.status}`,
					);
				}
				newStatus = params.status;
			}

			let newBlockedBy = current.blockedBy ? [...current.blockedBy] : [];
			if (params.removeBlockedBy && params.removeBlockedBy.length) {
				const toRemove = new Set(params.removeBlockedBy);
				newBlockedBy = newBlockedBy.filter((dep) => !toRemove.has(dep));
			}
			if (params.addBlockedBy && params.addBlockedBy.length) {
				for (const dep of params.addBlockedBy) {
					if (dep === current.id) {
						return errorResult(
							state,
							action,
							params,
							`cannot block #${current.id} on itself`,
						);
					}
					const depTask = state.tasks.find((t) => t.id === dep);
					if (!depTask) {
						return errorResult(
							state,
							action,
							params,
							`addBlockedBy: #${dep} not found`,
						);
					}
					if (depTask.status === "deleted") {
						return errorResult(
							state,
							action,
							params,
							`addBlockedBy: #${dep} is deleted`,
						);
					}
					if (!newBlockedBy.includes(dep)) newBlockedBy.push(dep);
				}
				if (detectCycle(state.tasks, current.id, newBlockedBy)) {
					return errorResult(
						state,
						action,
						params,
						"addBlockedBy would create a cycle in the blockedBy graph",
					);
				}
			}

			let newMetadata = current.metadata;
			if (params.metadata !== undefined) {
				const merged: Record<string, unknown> = { ...(current.metadata ?? {}) };
				for (const [k, v] of Object.entries(params.metadata)) {
					if (v === null) delete merged[k];
					else merged[k] = v;
				}
				newMetadata = Object.keys(merged).length ? merged : undefined;
			}

			const updated: Task = { ...current, status: newStatus };
			if (params.subject !== undefined) updated.subject = params.subject;
			if (params.description !== undefined) updated.description = params.description;
			if (params.activeForm !== undefined) updated.activeForm = params.activeForm;
			if (params.owner !== undefined) updated.owner = params.owner;
			if (newBlockedBy.length) {
				updated.blockedBy = newBlockedBy;
			} else {
				delete updated.blockedBy;
			}
			if (newMetadata === undefined) {
				delete updated.metadata;
			} else {
				updated.metadata = newMetadata;
			}

			const newTasks = [...state.tasks];
			newTasks[idx] = updated;
			const transition =
				current.status !== newStatus
					? ` (${current.status} → ${newStatus})`
					: "";
			return {
				state: { tasks: newTasks, nextId: state.nextId },
				details: {
					action: "update",
					params: params as Record<string, unknown>,
					tasks: newTasks,
					nextId: state.nextId,
				},
				content: [
					{ type: "text", text: `Updated #${updated.id}${transition}` },
				],
			};
		}

		case "list": {
			const includeDeleted = params.includeDeleted === true;
			const statusFilter = params.status;
			let view = state.tasks;
			if (!includeDeleted) {
				view = view.filter((t) => t.status !== "deleted");
			}
			if (statusFilter) {
				view = view.filter((t) => t.status === statusFilter);
			}
			const text =
				view.length === 0
					? "No tasks"
					: view
							.map((t) => {
								const unresolved = unresolvedDependencies(t, state.tasks);
								const block = t.status === "pending" || t.status === "in_progress"
									? unresolved.length ? ` ⛓ waiting on ${unresolved.map(id => `#${id}`).join(",")}` : t.status === "pending" ? " [ready to start]" : ""
									: "";
								const form =
									t.status === "in_progress" && t.activeForm
										? ` (${t.activeForm})`
										: "";
								return `[${t.status}] #${t.id} ${t.subject}${form}${block}`;
							})
							.join("\n");
			return {
				state,
				details: {
					action: "list",
					params: params as Record<string, unknown>,
					tasks: state.tasks,
					nextId: state.nextId,
				},
				content: [{ type: "text", text }],
			};
		}

		case "get": {
			if (params.id === undefined) {
				return errorResult(state, action, params, "id required for get");
			}
			const task = state.tasks.find((t) => t.id === params.id);
			if (!task) {
				return errorResult(state, action, params, `#${params.id} not found`);
			}
			const blocks = deriveBlocks(state.tasks).get(task.id) ?? [];
			const lines = [`#${task.id} [${task.status}] ${task.subject}`];
			if (task.description) lines.push(`  description: ${task.description}`);
			if (task.activeForm) lines.push(`  activeForm: ${task.activeForm}`);
			if (task.blockedBy?.length) {
				lines.push(
					`  blockedBy: ${task.blockedBy.map((id) => `#${id}`).join(", ")}`,
				);
			}
			if (blocks.length) {
				lines.push(`  blocks: ${blocks.map((id) => `#${id}`).join(", ")}`);
			}
			if (task.owner) lines.push(`  owner: ${task.owner}`);
			return {
				state,
				details: {
					action: "get",
					params: params as Record<string, unknown>,
					tasks: state.tasks,
					nextId: state.nextId,
				},
				content: [{ type: "text", text: lines.join("\n") }],
			};
		}

		case "delete": {
			if (params.id === undefined) {
				return errorResult(state, action, params, "id required for delete");
			}
			const idx = state.tasks.findIndex((t) => t.id === params.id);
			if (idx === -1) {
				return errorResult(state, action, params, `#${params.id} not found`);
			}
			const current = state.tasks[idx];
			if (current.status === "deleted") {
				return errorResult(
					state,
					action,
					params,
					`#${current.id} is already deleted`,
				);
			}
			const updated: Task = { ...current, status: "deleted" };
			const newTasks = [...state.tasks];
			newTasks[idx] = updated;
			return {
				state: { tasks: newTasks, nextId: state.nextId },
				details: {
					action: "delete",
					params: params as Record<string, unknown>,
					tasks: newTasks,
					nextId: state.nextId,
				},
				content: [
					{ type: "text", text: `Deleted #${updated.id}: ${updated.subject}` },
				],
			};
		}

		case "clear": {
			const count = state.tasks.length;
			return {
				state: { tasks: [], nextId: 1 },
				details: {
					action: "clear",
					params: params as Record<string, unknown>,
					tasks: [],
					nextId: 1,
				},
				content: [{ type: "text", text: `Cleared ${count} tasks` }],
			};
		}
	}
}

// ---------------------------------------------------------------------------
// Persistence — defensive snapshot replay
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTaskId(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}

function isTask(value: unknown): value is Task {
	return isRecord(value) && isTaskId(value.id) && typeof value.subject === "string" &&
		typeof value.status === "string" && Object.hasOwn(VALID_TRANSITIONS, value.status) &&
		isOptionalString(value.description) && isOptionalString(value.activeForm) && isOptionalString(value.owner) &&
		(value.blockedBy === undefined || (Array.isArray(value.blockedBy) && [...value.blockedBy].every(isTaskId))) &&
		(value.metadata === undefined || isRecord(value.metadata));
}

function isTaskSnapshot(value: unknown): value is ReducerState {
	if (!isRecord(value) || !Array.isArray(value.tasks) || !isTaskId(value.nextId)) return false;
	const ids = new Set<number>();
	for (const task of value.tasks) {
		if (!isTask(task) || task.id >= value.nextId || ids.has(task.id)) return false;
		ids.add(task.id);
	}
	return true;
}

function decodeSnapshot(value: unknown): ReducerState | undefined {
	try {
		if (!isTaskSnapshot(value)) return undefined;
		const snapshot: unknown = JSON.parse(JSON.stringify({ tasks: value.tasks, nextId: value.nextId }));
		// A malformed in-memory entry may fail to serialize or change shape.
		return isTaskSnapshot(snapshot) ? snapshot : undefined;
	} catch {
		return undefined;
	}
}

export function reconstructTodoState(ctx: SessionContext): string | undefined {
	const manager = getSessionManager(ctx);
	const sessionId = getSessionId(manager);
	if (!manager || sessionId === undefined) return;
	let state = emptyState();
	for (const entry of manager.getBranch()) {
		if (entry?.type === "custom" && entry.customType === TODO_STATE_ENTRY) {
			const data: unknown = entry.data;
			if (isRecord(data) && data.version === 1) state = decodeSnapshot(data) ?? state;
			continue;
		}
		if (entry?.type !== "message") continue;
		const msg = entry.message;
		if (msg?.role !== "toolResult" || msg.toolName !== TOOL_NAME) continue;
		const details: unknown = msg.details;
		// New results are projections of checkpoints and cannot roll back a
		// newer mutation. Unmarked legacy results keep their replay order.
		if (!isRecord(details) || Object.hasOwn(details, "stateSource")) continue;
		state = decodeSnapshot(details) ?? state;
	}
	sessionStates.set(sessionId, state);
	return sessionId;
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function formatStatus(status: TaskStatus): string {
	switch (status) {
		case "in_progress": return "in progress";
		case "deleted": return "deleted";
		default: return status;
	}
}

const STATUS_GLYPH: Record<TaskStatus, string> = {
	pending: "○",
	in_progress: "◐",
	completed: "●",
	deleted: "⊘",
};

// Mirrors todo-overlay.ts:statusGlyph palette, but uses `muted` for deleted so
// a successful delete is visually distinct from the error branch (which uses
// `error` + `✗`).
const STATUS_COLOR: Record<TaskStatus, "dim" | "warning" | "success" | "muted"> = {
	pending: "dim",
	in_progress: "warning",
	completed: "success",
	deleted: "muted",
};

const ACTION_GLYPH: Record<TaskAction, string> = {
	create: "+",
	update: "→",
	delete: "×",
	get: "›",
	list: "☰",
	clear: "∅",
};

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

const TodoParams = Type.Object({
	action: StringEnum(["create", "update", "list", "get", "delete", "clear"] as const),
	subject: Type.Optional(
		Type.String({ description: "Task subject line (required for create)" }),
	),
	description: Type.Optional(
		Type.String({ description: "Long-form task description" }),
	),
	activeForm: Type.Optional(
		Type.String({
			description:
				"Present-continuous spinner label shown while status is in_progress (e.g. 'writing tests')",
		}),
	),
	status: Type.Optional(
		StringEnum(["pending", "in_progress", "completed", "deleted"] as const, {
			description: "Target status (update) or list filter (list)",
		}),
	),
	blockedBy: Type.Optional(
		Type.Array(Type.Number(), {
			description: "Initial blockedBy ids (create only)",
		}),
	),
	addBlockedBy: Type.Optional(
		Type.Array(Type.Number(), {
			description: "Task ids to add to blockedBy (update only, additive merge)",
		}),
	),
	removeBlockedBy: Type.Optional(
		Type.Array(Type.Number(), {
			description: "Task ids to remove from blockedBy (update only, additive merge)",
		}),
	),
	owner: Type.Optional(
		Type.String({ description: "Agent/owner assigned to this task" }),
	),
	metadata: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description:
				"Arbitrary metadata; pass null value for a key to delete that key on update",
		}),
	),
	id: Type.Optional(
		Type.Number({
			description: "Task id (required for update, get, delete)",
		}),
	),
	includeDeleted: Type.Optional(
		Type.Boolean({
			description:
				"If true, list action returns deleted (tombstoned) tasks as well. Default: false.",
		}),
	),
});

export function registerTodoTool(pi: ExtensionAPI, getForegroundSessionId?: () => string | undefined): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: TOOL_LABEL,
		description:
			"Manage a task list for tracking multi-step progress. Actions: create (new task), update (change status/fields/dependencies), list (all tasks, optionally filtered by status), get (single task details), delete (tombstone), clear (reset all). Status: pending → in_progress → completed, plus deleted tombstone. Use this to plan and track multi-step work like research, design, and implementation.",
		promptSnippet: "Manage a Claude-Code-style task list to track multi-step progress",
		promptGuidelines: [
			"Use `todo` for complex work with 3+ steps, when the user gives you a list of tasks, or immediately after receiving new instructions to capture requirements. Skip it for single trivial tasks and purely conversational requests.",
			"When starting any task, mark it in_progress BEFORE beginning work. Mark it completed IMMEDIATELY when done — never batch completions. Exactly one task should be in_progress at a time.",
			"Never mark a task completed if tests are failing, the implementation is partial, or you hit unresolved errors — keep it in_progress and create a new task for the blocker instead.",
			"Task status is a 4-state machine: pending → in_progress → completed, plus deleted as a tombstone. Pass activeForm (present-continuous label, e.g. 'researching existing tool') when marking in_progress.",
			"Use blockedBy to express dependencies (A is blocked by B). On create, pass blockedBy as the initial set. On update, use addBlockedBy / removeBlockedBy (additive merge — do not resend the full array). Cycles are rejected.",
			"list hides tombstoned (deleted) tasks by default; pass includeDeleted:true to see them. Pass status to filter by a single status.",
			"Deleting even a completed prerequisite makes dependent readiness unresolved again. Keep completed prerequisites, or explicitly removeBlockedBy on dependents if the dependency should be released.",
			"Subject must be short and imperative (e.g. 'Research existing tool'); description is for long-form detail. activeForm is a present-continuous label shown while in_progress.",
		],
		parameters: TodoParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const action = params.action as TaskAction;
			const sessionId = getTodoSessionId(ctx);
			const current = getState(sessionId);
			if (sessionId === undefined) {
				const result = errorResult(current, action, {}, ERR_UNKNOWN_SESSION);
				return { content: result.content, details: { ...result.details, stateSource: "native-entry-v1" as const }, isError: true };
			}
			const result = applyTaskMutation(
				current,
				action,
				params as TaskMutationParams,
			);
			const mutation = !result.details.error && ["create", "update", "delete", "clear"].includes(action);
			let checkpoint: { version: number; tasks: Task[]; nextId: number } | undefined;
			if (mutation) {
				try {
					if (typeof pi.appendEntry !== "function") throw new Error();
					// Detach the native entry from caller metadata and returned mutable details.
					const snapshot: unknown = JSON.parse(JSON.stringify(result.state));
					if (!isTaskSnapshot(snapshot)) throw new Error();
					checkpoint = { version: 1, ...snapshot };
				} catch {
					const error = "Todo mutation not applied: native snapshot persistence is unavailable or state is not serializable.";
					return { content: [{ type: "text" as const, text: error }], details: { action: result.details.action, params: {}, tasks: current.tasks, nextId: current.nextId, stateSource: "native-entry-v1" as const, error }, isError: true };
				}
			}
			if (checkpoint) {
				sessionStates.set(sessionId, result.state);
				try {
					pi.appendEntry(TODO_STATE_ENTRY, checkpoint);
				} catch {
					// An append may have partially succeeded. Keep the actual in-memory
					// mutation/IDs, never roll it back or advise blindly repeating it.
					const error = "Todo state changed in this session, but persistence is unconfirmed. Inspect todo list before retrying; do not blindly repeat the mutation.";
					return { content: [{ type: "text" as const, text: error }], details: { ...result.details, stateSource: "native-entry-v1" as const, error }, isError: true };
				}
			}
			return {
				content: result.content,
				details: { ...result.details, stateSource: "native-entry-v1" as const },
				...(result.details.error ? { isError: true } : {}),
			};
		},

		renderCall(args, theme, _context) {
			const action = args.action as TaskAction;
			const glyph = ACTION_GLYPH[action] ?? action;
			let text = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", glyph);

			if (action === "create" && args.subject) {
				text += ` ${theme.fg("dim", args.subject)}`;
			} else if (
				(action === "update" || action === "get" || action === "delete") &&
				args.id !== undefined
			) {
				// Pi's render context has no session id. Only look in this
				// registration's foreground slot, never search sibling sessions.
				const subject = getTodos(getForegroundSessionId?.()).find((t) => t.id === args.id)?.subject;
				text += ` ${theme.fg("accent", subject ?? `#${args.id}`)}`;
			} else if (action === "list" && args.status) {
				text += ` ${theme.fg("muted", formatStatus(args.status as TaskStatus))}`;
			} else if (action === "clear") {
				// nothing extra
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _opts, theme, _context) {
			if (result.isError || (result.details as TaskDetails | undefined)?.error) {
				return new Text(theme.fg("error", "✗"), 0, 0);
			}
			const details = result.details as TaskDetails | undefined;
			// Only create/update/delete advertise a status; list/get/clear render a
			// plain ✓. This prevents list from rendering the last task's status as
			// if it were the operation's result.
			let status: TaskStatus | undefined;
			if (details) {
				const params = details.params as TaskMutationParams;
				switch (details.action) {
					case "create":
						// New task is the last element of details.tasks.
						status = details.tasks[details.tasks.length - 1]?.status;
						break;
					case "update":
						status = details.tasks.find((t) => t.id === params.id)?.status;
						break;
					case "delete":
						status = details.tasks.find((t) => t.id === params.id)?.status;
						break;
					case "list":
					case "get":
					case "clear":
						break;
				}
			}
			if (status) {
				return new Text(
					theme.fg(STATUS_COLOR[status], `${STATUS_GLYPH[status]} ${formatStatus(status)}`),
					0,
					0,
				);
			}
			return new Text(theme.fg("success", "✓"), 0, 0);
		},
	});
}

// ---------------------------------------------------------------------------
// /todos slash command
// ---------------------------------------------------------------------------

export function registerTodosCommand(pi: ExtensionAPI): void {
	pi.registerCommand(COMMAND_NAME, {
		description: "Show all todos on the current branch, grouped by status",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify(ERR_REQUIRES_INTERACTIVE, "error");
				return;
			}
			const action = args.trim();
			if (action && action !== "ready") {
				ctx.ui.notify("Usage: /todos [ready]", "warning");
				return;
			}
			const sessionId = getTodoSessionId(ctx);
			if (sessionId === undefined) {
				ctx.ui.notify(ERR_UNKNOWN_SESSION, "error");
				return;
			}
			const tasks = getTodos(sessionId);
			if (action === "ready") {
				const ready = readyTasks(tasks);
				ctx.ui.notify(ready.length ? `Ready to start (not auto-scheduled):\n${ready.map(t => `#${t.id} ${t.subject}`).join("\n")}` : "No pending tasks are ready to start.", "info");
				return;
			}
			const visible = tasks.filter((t) => t.status !== "deleted");
			if (visible.length === 0) {
				ctx.ui.notify(MSG_NO_TODOS, "info");
				return;
			}

			const pending = visible.filter((t) => t.status === "pending");
			const inProgress = visible.filter((t) => t.status === "in_progress");
			const completed = visible.filter((t) => t.status === "completed");

			const header: string[] = [];
			if (completed.length > 0) {
				header.push(`${completed.length}/${visible.length} completed`);
			}
			if (inProgress.length > 0) {
				header.push(`${inProgress.length} ${formatStatus("in_progress")}`);
			}
			if (pending.length > 0) {
				header.push(`${pending.length} pending`);
			}

			header.push(`${readyTasks(tasks).length} ready to start`);
			const lines: string[] = [header.join(" · ")];

			const renderTask = (t: Task, glyph: string): string => {
				const form =
					t.status === "in_progress" && t.activeForm
						? ` (${t.activeForm})`
						: "";
				const unresolved = unresolvedDependencies(t, tasks);
				const block = t.status === "pending" || t.status === "in_progress"
					? unresolved.length ? `    ⛓ waiting on ${unresolved.map(id => `#${id}`).join(",")}` : t.status === "pending" ? " [ready to start]" : ""
					: "";
				return `  ${glyph} #${t.id} ${t.subject}${form}${block}`;
			};

			if (pending.length > 0) {
				lines.push("── Pending ──");
				for (const t of pending) lines.push(renderTask(t, "○"));
			}
			if (inProgress.length > 0) {
				lines.push("── In Progress ──");
				for (const t of inProgress) lines.push(renderTask(t, "◐"));
			}
			if (completed.length > 0) {
				lines.push("── Completed ──");
				for (const t of completed) lines.push(renderTask(t, "✓"));
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
