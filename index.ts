/**
 * rpiv-todo — Pi extension
 *
 * Registers the `todo` tool, `/todos` slash command, and the five lifecycle
 * hooks that manage branch-replay state reconstruction and the TodoOverlay
 * persistent widget.
 *
 * Extracted from rpiv-pi@7525a5d. Tool name "todo" and widget key
 * "rpiv-todos" preserved verbatim so existing session history replays
 * correctly after upgrade.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TOOL_NAME, evictTodoState, getTodoSessionId, registerTodoTool, registerTodosCommand, reconstructTodoState } from "./todo.js";
import { TodoOverlay } from "./todo-overlay.js";

export default function (pi: ExtensionAPI) {
    let foregroundSessionId: string | undefined;
    let todoOverlay: TodoOverlay | undefined;

    registerTodoTool(pi, () => foregroundSessionId);
    registerTodosCommand(pi);

    pi.on("session_start", async (_event, ctx) => {
        const sessionId = reconstructTodoState(ctx);
        if (sessionId === undefined || !ctx.hasUI) return;
        // The first UI-bearing session owns the foreground. A child with a
        // relayed UI must not rebind the widget or the tool's render pointer.
        foregroundSessionId ??= sessionId;
        if (sessionId !== foregroundSessionId) return;
        todoOverlay ??= new TodoOverlay(sessionId);
        todoOverlay.setUICtx(ctx.ui);
        todoOverlay.update();
    });

    function replayAndRefresh(ctx: ExtensionContext): void {
        const sessionId = reconstructTodoState(ctx);
        if (sessionId !== undefined && sessionId === foregroundSessionId) todoOverlay?.update();
    }

    pi.on("session_compact", (_event, ctx) => replayAndRefresh(ctx));
    pi.on("session_tree", (_event, ctx) => replayAndRefresh(ctx));

    pi.on("session_shutdown", async (_event, ctx) => {
        const sessionId = getTodoSessionId(ctx);
        if (sessionId === undefined) return;
        evictTodoState(sessionId);
        if (sessionId !== foregroundSessionId) return;
        const overlay = todoOverlay;
        foregroundSessionId = undefined;
        todoOverlay = undefined;
        overlay?.dispose();
    });

    // Refresh live state, not the potentially stale branch, after a todo call.
    pi.on("tool_execution_end", async (event, ctx) => {
        if (event.toolName !== TOOL_NAME || event.isError) return;
        if (foregroundSessionId !== undefined && getTodoSessionId(ctx) === foregroundSessionId) todoOverlay?.update();
    });
}
