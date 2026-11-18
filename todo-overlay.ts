/**
 * todo-overlay.ts — Persistent widget showing todo list above the editor.
 *
 * Mirrors @tintinweb/pi-subagents's AgentWidget shape: factory-form setWidget
 * registration in widgetContainerAbove, register-once + requestRender() refresh,
 * configurable collapse-not-scroll, auto-hide when empty. No timer (todos have no
 * animation), no status bar, no aging map.
 *
 * Data source is the foreground session's live tasks read at render time — NEVER
 * reconstructTodoState from a tool_execution_end handler, since the persisted
 * branch is stale at that point (message_end runs after the extension event).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type {
	ExtensionUIContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	truncateToWidth,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	type TUI,
} from "@earendil-works/pi-tui";
import { getTodos, readyTasks, unresolvedDependencies, type Task, type TaskStatus } from "./todo.js";

// ---- Constants ----

const WIDGET_KEY = "rpiv-todos";
const DEFAULT_MAX_WIDGET_LINES = 12;

function readMaxWidgetLines(): number {
	const home = homedir();
	const xdg = process.env.XDG_CONFIG_HOME?.trim() ?? "";
	const configHome = xdg === "~" ? home : xdg.startsWith("~/") ? join(home, xdg.slice(2)) : xdg;
	const configFile = (dir: string): string => join(dir, "rpiv-todo", "config.json");
	const xdgFile = isAbsolute(configHome) ? configFile(configHome) : undefined;
	// Fall back to the legacy path only if the XDG file is absent, not malformed.
	const path = xdgFile && existsSync(xdgFile) ? xdgFile : configFile(join(home, ".config"));
	try {
		const config: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (config !== null && typeof config === "object" && "maxWidgetLines" in config) {
			const value = config.maxWidgetLines;
			// Three rows fit a heading, a task, and an overflow summary.
			if (value === 0 || (typeof value === "number" && Number.isSafeInteger(value) && value >= 3)) return value;
		}
	} catch {
		// A missing or unreadable optional config must not interrupt the session.
	}
	return DEFAULT_MAX_WIDGET_LINES;
}

// ---- Helpers ----

function statusGlyph(status: TaskStatus, theme: Theme): string {
	switch (status) {
		case "pending":
			return theme.fg("dim", "○");
		case "in_progress":
			return theme.fg("warning", "◐");
		case "completed":
			return theme.fg("success", "✓");
		case "deleted":
			return theme.fg("error", "✗");
	}
}

// ---- Controller ----

export class TodoOverlay {
	private uiCtx: ExtensionUIContext | undefined;
	private widgetRegistered = false;
	private tui: TUI | undefined;
	private collapsed = false;
	private maxWidgetLines = DEFAULT_MAX_WIDGET_LINES;

	private readonly sessionId: string;

	constructor(sessionId: string) {
		this.sessionId = sessionId;
	}

	/** Called on foreground session start; config is not read during rendering. */
	setUICtx(ctx: ExtensionUIContext): void {
		if (ctx !== this.uiCtx) this.unregisterWidget();
		this.uiCtx = ctx;
		this.maxWidgetLines = readMaxWidgetLines();
	}

	/**
	 * Idempotent refresh. Safe to call from session_start, session_compact,
	 * session_tree, and tool_execution_end. Reads live state via getTodos() —
	 * NEVER calls reconstructTodoState (branch is stale during tool events).
	 */
	update(): void {
		const uiCtx = this.uiCtx;
		if (!uiCtx) return;

		// Empty or explicitly disabled → unregister and clear cached refs.
		if (this.maxWidgetLines === 0 || !getTodos(this.sessionId).some((t) => t.status !== "deleted")) {
			this.collapsed = false;
			this.unregisterWidget();
			return;
		}

		// Non-empty → register once, then requestRender on subsequent updates.
		if (!this.widgetRegistered) {
			uiCtx.setWidget(
				WIDGET_KEY,
				(tui, theme) => {
					if (this.uiCtx === uiCtx) this.tui = tui;
					return {
						render: (width: number) => this.uiCtx === uiCtx ? this.renderWidget(uiCtx.theme ?? theme, width) : [],
						handleMouse: (event: TuiMouseEvent) => this.uiCtx === uiCtx && this.widgetRegistered
							? this.handleHeadingClick(event) : undefined,
						invalidate: () => {}, // No cached rows; render reads the live UI theme.
					};
				},
				{ placement: "aboveEditor" },
			);
			this.widgetRegistered = true;
		} else {
			this.tui?.requestRender();
		}
	}

	private handleHeadingClick(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "click" || event.button !== "left" || event.y !== 0) return undefined;
		if (event.shift || event.alt || event.ctrl) return undefined;
		this.collapsed = !this.collapsed;
		return { handled: true, render: true };
	}

	/**
	 * Build rendered rows. Called from the registered widget's render() closure,
	 * so it reads live state each time via getTodos() rather than capturing it.
	 * Preserves natural (insertion) order. On overflow, drops completed tasks
	 * first (in-place — remaining items stay in natural order), then truncates
	 * the non-completed tail if still overflowing.
	 */
	private renderWidget(theme: Theme, width: number): string[] {
		if (this.maxWidgetLines === 0) return [];

		const all = getTodos(this.sessionId).filter((t) => t.status !== "deleted");
		if (all.length === 0) return [];

		const truncate = (line: string): string => truncateToWidth(line, width);

		const completedCount = all.filter((t) => t.status === "completed").length;
		const totalVisible = all.length;
		const hasActive = all.some(
			(t) => t.status === "in_progress" || t.status === "pending",
		);
		// Show per-row ids only when at least one task has a blockedBy
		// reference — otherwise the `⛓ #N` suffix on a dep row couldn't be
		// resolved against any visible task.
		const showIds = all.some((t) => t.blockedBy && t.blockedBy.length > 0);

		const headingColor = hasActive ? "accent" : "dim";
		const headingIcon = hasActive ? "●" : "○";
		const headingText = `Todos (${completedCount}/${totalVisible}) · ${readyTasks(all).length} ready`;
		const heading = truncate(
			theme.fg(headingColor, headingIcon) +
				" " +
				theme.fg(headingColor, headingText),
		);

		if (this.collapsed) {
			return [
				heading,
				truncate(theme.fg("dim", "└─ Click heading to expand")),
			];
		}

		const lines: string[] = [heading];
		const maxBody = this.maxWidgetLines - 1; // heading takes 1 row

		// Happy path: everything fits in natural order.
		if (all.length <= maxBody) {
			for (const t of all) {
				lines.push(
					truncate(
						theme.fg("dim", "├─") + " " + this.formatTaskLine(t, theme, showIds),
					),
				);
			}
			const last = lines.length - 1;
			lines[last] = lines[last].replace("├─", "└─");
			return lines;
		}

		// Overflow path: reserve 1 line for the summary, drop completed first
		// (in natural order), then truncate the non-completed tail if needed.
		const budget = maxBody - 1;
		const nonCompleted = all.filter((t) => t.status !== "completed");

		let visible: Task[];
		let truncatedTailCount = 0;
		if (nonCompleted.length <= budget) {
			// Dropping completed alone was enough. Fill remaining slots with
			// completed tasks from `all` until the budget is hit, then re-sort
			// into natural order.
			const kept = new Set<Task>(nonCompleted);
			for (const t of all) {
				if (kept.size >= budget) break;
				if (t.status === "completed") kept.add(t);
			}
			visible = all.filter((t) => kept.has(t));
		} else {
			// Even dropping all completed isn't enough — truncate the
			// non-completed tail.
			const kept = new Set(nonCompleted.filter(t => t.status === "in_progress").slice(0, budget));
			for (const t of nonCompleted) {
				if (kept.size >= budget) break;
				kept.add(t);
			}
			visible = nonCompleted.filter(t => kept.has(t));
			truncatedTailCount = nonCompleted.length - visible.length;
		}

		for (const t of visible) {
			lines.push(
				truncate(
					theme.fg("dim", "├─") + " " + this.formatTaskLine(t, theme, showIds),
				),
			);
		}

		const shownCompleted = visible.filter(
			(t) => t.status === "completed",
		).length;
		const hiddenCompleted = completedCount - shownCompleted;
		const totalHidden = hiddenCompleted + truncatedTailCount;
		const overflowParts: string[] = [];
		if (hiddenCompleted > 0) overflowParts.push(`${hiddenCompleted} completed`);
		if (truncatedTailCount > 0) overflowParts.push(`${truncatedTailCount} pending`);
		lines.push(
			truncate(
				theme.fg("dim", "└─") +
					" " +
					theme.fg(
						"dim",
						overflowParts.length > 0
							? `+${totalHidden} more (${overflowParts.join(", ")})`
							: `+${totalHidden} more`,
					),
			),
		);
		return lines;
	}

	private formatTaskLine(t: Task, theme: Theme, showId: boolean): string {
		const glyph = statusGlyph(t.status, theme);
		const subjectColor =
			t.status === "completed" || t.status === "deleted" ? "dim" : "text";
		let subject = theme.fg(subjectColor, t.subject);
		if (t.status === "completed" || t.status === "deleted") {
			subject = theme.strikethrough(subject);
		}
		let line = `${glyph}`;
		if (showId) {
			line += ` ${theme.fg("accent", `#${t.id}`)}`;
		}
		line += ` ${subject}`;
		if (t.status === "in_progress" && t.activeForm) {
			line += " " + theme.fg("dim", `(${t.activeForm})`);
		}
		if (t.status === "pending" || t.status === "in_progress") {
			const unresolved = unresolvedDependencies(t, getTodos(this.sessionId));
			if (unresolved.length) line += " " + theme.fg("dim", `⛓ waiting #${unresolved.join(",#")}`);
			else if (t.status === "pending") line += " " + theme.fg("dim", "[ready]");
		}
		return line;
	}

	private unregisterWidget(): void {
		if (!this.widgetRegistered) return;
		this.widgetRegistered = false;
		this.tui = undefined;
		this.uiCtx?.setWidget(WIDGET_KEY, undefined);
	}

	dispose(): void {
		const uiCtx = this.uiCtx;
		this.widgetRegistered = false;
		this.tui = undefined;
		this.uiCtx = undefined;
		this.collapsed = false;
		uiCtx?.setWidget(WIDGET_KEY, undefined);
	}
}
