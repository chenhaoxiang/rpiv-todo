import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Container, Spacer, TuiAltScreen, VStack } from '@earendil-works/pi-tui';
import { loadSource, theme } from './helpers/source-vm.mjs';

async function configFixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'rpiv-todo-overlay-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const xdg = join(home, 'xdg');
  return {
    env: { HOME: home, XDG_CONFIG_HOME: xdg },
    xdgFile: join(xdg, 'rpiv-todo', 'config.json'),
    legacyFile: join(home, '.config', 'rpiv-todo', 'config.json'),
  };
}

async function writeConfig(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

function session(id, tasks = []) {
  const widgets = [];
  const branch = tasks.length ? [{
    type: 'custom', customType: 'rpiv-todo-state', data: { version: 1, tasks, nextId: tasks.length + 1 },
  }] : [];
  let widget;
  const ctx = {
    hasUI: true,
    sessionManager: { getSessionId: () => id, getBranch: () => branch },
    ui: {
      onTerminalInput: () => assert.fail('must not register a raw input hook'),
      setWidget(key, factory) {
        assert.equal(key, 'rpiv-todos');
        widget = factory?.({ requestRender() {} }, theme);
        widgets.push(widget);
      },
    },
  };
  return { ctx, widgets, get widget() { return widget; }, rows: () => widget?.render(80) ?? [] };
}

async function harness(configEnv) {
  const mod = await loadSource(new URL('../index.ts', import.meta.url), configEnv);
  const hooks = new Map();
  let tool;
  mod.default({
    registerTool: value => { tool = value; },
    registerCommand() {},
    registerShortcut: () => assert.fail('must not register a global shortcut'),
    appendEntry() {},
    on: (name, handler) => hooks.set(name, handler),
  });
  return {
    start: (ctx) => hooks.get('session_start')({}, ctx),
    shutdown: (ctx) => hooks.get('session_shutdown')({}, ctx),
    execute: async (ctx, params) => {
      const result = await tool.execute('call', params, undefined, undefined, ctx);
      assert.notEqual(result.isError, true, JSON.stringify(result));
      await hooks.get('tool_execution_end')({ toolName: 'todo', isError: false }, ctx);
      return result;
    },
  };
}

const tasks = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, subject: `Task ${i + 1}`, status: 'pending' }));

test('TodoOverlay reads XDG first and accepts only 0 or safe integers of at least 3', async (t) => {
  const { env, xdgFile, legacyFile } = await configFixture(t);
  const h = await harness(env);
  const s = session('foreground', tasks);
  await h.start(s.ctx);
  assert.equal(s.rows().length, 12, 'missing config uses the historical budget');

  await writeConfig(legacyFile, '{"maxWidgetLines":4}');
  assert.equal(s.rows().length, 12, 'edits do not apply on repaint');
  await h.start(s.ctx);
  assert.equal(s.rows().length, 4, 'missing XDG file falls back to legacy');

  const xdgText = '{"maxWidgetLines":3}\n';
  await writeConfig(xdgFile, xdgText);
  await h.start(s.ctx);
  assert.equal(s.rows().length, 3);
  assert.match(s.rows().at(-1), /\+14 more/);
  assert.equal(await readFile(xdgFile, 'utf8'), xdgText, 'config is not rewritten');

  for (const text of ['{malformed', 'null', '[]', ...[1, 2, -1, 3.5, 2 ** 53, '3', true].map(
    maxWidgetLines => JSON.stringify({ maxWidgetLines }),
  )]) {
    await writeConfig(xdgFile, text);
    await h.start(s.ctx);
    assert.equal(s.rows().length, 12, text);
  }
});

test('TodoOverlay maxWidgetLines 0 unregisters on rebind and does not affect the todo tool', async (t) => {
  const { env, xdgFile } = await configFixture(t);
  const h = await harness(env);
  const s = session('foreground', tasks);
  await h.start(s.ctx);
  assert.equal(s.widgets.length, 1);
  await writeConfig(xdgFile, '{"maxWidgetLines":0}');
  await h.start(s.ctx);
  assert.deepEqual(s.widgets.slice(1), [undefined]);
  await h.execute(s.ctx, { action: 'create', subject: 'Still visible to the tool' });
  const list = await h.execute(s.ctx, { action: 'list' });
  assert.equal(list.details.tasks.length, 16);
  assert.equal(s.widgets.length, 2, 'disabled overlay is not re-registered');
  await h.shutdown(s.ctx);
  assert.equal(s.widgets.length, 3);
  assert.equal(s.widgets.at(-1), undefined);
});

function fullscreenHeadingClick(t, widget) {
  let input;
  const terminal = {
    columns: 80, rows: 24, start: (handler) => { input = handler; },
    stop() {}, write() {}, showCursor() {}, hideCursor() {},
  };
  const tui = new TuiAltScreen(terminal, false, undefined, { copyOnSelect: false });
  const widgetsAbove = new Container();
  widgetsAbove.addChild(new Spacer(1));
  widgetsAbove.addChild(widget);
  tui.setLayoutRoot(new VStack([{ component: widgetsAbove }]));
  tui.start();
  t.after(() => tui.stop());
  return () => {
    tui.renderNow();
    const row = tui.getScreenLines().findIndex(line => line.includes('Todos')) + 1;
    assert.ok(row, 'heading is visible on the fullscreen renderer');
    input(`\x1b[<0;4;${row}M`);
    input(`\x1b[<0;4;${row}m`);
  };
}

test('TodoOverlay heading click toggles in fullscreen and preserves the live heading', async (t) => {
  const h = await harness();
  const s = session('foreground', tasks.slice(0, 3));
  await h.start(s.ctx);
  const widget = s.widget;
  const click = (overrides = {}) => widget.handleMouse({
    type: 'click', button: 'left', x: 2, y: 0, screenX: 2, screenY: 2,
    width: 80, height: 2, shift: false, alt: false, ctrl: false, ...overrides,
  });
  for (const overrides of [{ ctrl: true }, { button: 'right' }, { y: 1 }, { type: 'drag' }]) {
    assert.equal(click(overrides), undefined);
  }
  assert.equal(s.rows().length, 4);

  const headingClick = fullscreenHeadingClick(t, widget);
  headingClick();
  assert.equal(s.rows().length, 2);
  assert.match(s.rows()[0], /Todos \(0\/3\)/);
  assert.match(s.rows()[1], /Click heading to expand/);
  await h.execute(s.ctx, { action: 'update', id: 1, status: 'completed' });
  assert.match(s.rows()[0], /Todos \(1\/3\)/);
  const expanded = widget.handleMouse({
    type: 'click', button: 'left', x: 2, y: 0, screenX: 2, screenY: 2,
    width: 80, height: 2, shift: false, alt: false, ctrl: false,
  });
  assert.equal(expanded.handled, true);
  assert.match(s.rows()[1], /✓ Task 1/);
  assert.equal(s.widgets.length, 1, 'refresh and toggles do not re-register the widget');
});

test('TodoOverlay unregisters the empty foreground even after invalidation; a child never owns its widget', async () => {
  const h = await harness();
  const parent = session('parent', tasks.slice(0, 2));
  const child = session('child');
  await h.start(parent.ctx);
  await h.start(child.ctx);
  await h.execute(child.ctx, { action: 'create', subject: 'Child task' });
  assert.equal(child.widgets.length, 0);
  assert.match(parent.rows().join('\n'), /Task 1/);
  assert.doesNotMatch(parent.rows().join('\n'), /Child task/);

  parent.widget.invalidate();
  await h.execute(parent.ctx, { action: 'clear' });
  assert.equal(parent.widgets.length, 2);
  assert.equal(parent.widgets.at(-1), undefined);
  await h.execute(parent.ctx, { action: 'create', subject: 'New foreground task' });
  assert.match(parent.rows().join('\n'), /New foreground task/);
});
