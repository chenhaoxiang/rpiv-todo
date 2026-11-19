import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource, theme } from './helpers/source-vm.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const task = (id, subject, extra) => ({ id, subject, status: 'pending', ...extra });
const custom = (tasks, nextId) => ({
  type: 'custom', customType: 'rpiv-todo-state', data: { version: 1, tasks, nextId },
});
const legacy = (tasks, nextId) => ({
  type: 'message', message: { role: 'toolResult', toolName: 'todo', details: { tasks, nextId } },
});

function session(id, branch = [], hasUI = true) {
  const notices = [], widgets = [];
  let widget, renders = 0;
  const ctx = {
    hasUI,
    sessionManager: { getSessionId: () => id, getBranch: () => branch },
    ui: {
      notify: (message, level) => notices.push([message, level]),
      setWidget(key, factory) {
        widgets.push({ key, factory });
        widget = factory?.({ requestRender: () => renders++ }, theme);
      },
    },
  };
  return { ctx, notices, widgets, get renders() { return renders; }, widgetText: () => widget?.render(80).join('\n') };
}

async function harness() {
  const mod = await loadSource(new URL('../index.ts', import.meta.url));
  const hooks = new Map(), appends = [];
  let tool, command;
  mod.default({
    registerTool: value => { tool = value; },
    registerCommand: (_name, value) => { command = value; },
    appendEntry: (...args) => appends.push(args),
    on: (name, handler) => hooks.set(name, handler),
  });
  const execute = ({ ctx }, args) => tool.execute('call', args, undefined, undefined, ctx);
  return {
    appends, execute,
    emit: (name, s, event = {}) => hooks.get(name)(event, s?.ctx),
    list: async s => plain((await execute(s, { action: 'list' })).details.tasks),
    command: (s, args = '') => command.handler(args, s.ctx),
    renderCall: id => tool.renderCall({ action: 'get', id }, theme, {}).render(80).join(''),
  };
}

test('todo, /todos, overlay, and renderCall remain isolated when a child has a relayed UI', async () => {
  const h = await harness();
  const parent = session('parent');
  const child = session('child');
  const toolEnd = { toolName: 'todo', isError: false };
  await h.emit('session_start', parent);
  assert.deepEqual(plain((await h.execute(parent, { action: 'create', subject: 'parent task' })).details.tasks), [task(1, 'parent task')]);
  await h.emit('tool_execution_end', parent, toolEnd);
  await h.emit('session_start', child);
  assert.deepEqual(plain((await h.execute(child, { action: 'create', subject: 'child task' })).details.tasks), [task(1, 'child task')]);
  await h.execute(child, { action: 'create', subject: 'child-only second task' });
  await h.emit('tool_execution_end', child, toolEnd);

  await h.command(parent);
  await h.command(child, 'ready');
  assert.match(parent.notices.at(-1)[0], /parent task/);
  assert.doesNotMatch(parent.notices.at(-1)[0], /child task/);
  assert.match(child.notices.at(-1)[0], /child task/);
  assert.doesNotMatch(child.notices.at(-1)[0], /parent task/);
  assert.equal(parent.widgets.length, 1);
  assert.equal(parent.widgets[0].key, 'rpiv-todos');
  assert.equal(parent.renders, 0, 'child events do not refresh the foreground widget');
  assert.equal(child.widgets.length, 0);
  assert.match(parent.widgetText(), /parent task/);
  assert.doesNotMatch(parent.widgetText(), /child task/);
  assert.match(h.renderCall(1), /parent task/);
  assert.match(h.renderCall(2), /#2/);

  await h.emit('session_shutdown', child);
  assert.deepEqual(await h.list(child), []);
  assert.deepEqual(await h.list(parent), [task(1, 'parent task')]);
  assert.equal(parent.widgets.length, 1);
  await h.emit('session_shutdown', parent);
  assert.equal(parent.widgets.at(-1).factory, undefined);
  assert.match(h.renderCall(1), /#1/);
});

test('session_tree, session_compact, and reload replace only the matching session state', async () => {
  const h = await harness();
  const parentBranch = [legacy([task(4, 'parent snapshot')], 5)];
  const childBranch = [custom([task(8, 'child snapshot')], 9)];
  const parent = session('parent', parentBranch);
  const child = session('child', childBranch, false);
  await h.emit('session_start', parent);
  await h.emit('session_start', child);
  assert.equal((await h.execute(parent, { action: 'create', subject: 'parent live' })).details.tasks.at(-1).id, 5);
  assert.equal((await h.execute(child, { action: 'create', subject: 'child live' })).details.tasks.at(-1).id, 9);

  childBranch.push(custom([task(10, 'child tree')], 11));
  await h.emit('session_tree', child);
  assert.deepEqual(await h.list(child), [task(10, 'child tree')]);
  assert.deepEqual(await h.list(parent), [task(4, 'parent snapshot'), task(5, 'parent live')]);
  assert.equal(parent.renders, 0);
  parentBranch.push(custom([task(6, 'parent compacted')], 7));
  await h.emit('session_compact', parent);
  assert.deepEqual(await h.list(parent), [task(6, 'parent compacted')]);
  assert.deepEqual(await h.list(child), [task(10, 'child tree')]);
  assert.equal(parent.renders, 1);

  await h.emit('session_shutdown', parent, { reason: 'reload' });
  const reloaded = session('parent', parentBranch);
  await h.emit('session_start', reloaded, { reason: 'reload' });
  assert.match(reloaded.widgetText(), /parent compacted/);
  assert.equal((await h.execute(reloaded, { action: 'create', subject: 'after reload' })).details.tasks.at(-1).id, 7);
  assert.equal((await h.execute(child, { action: 'create', subject: 'after tree' })).details.tasks.at(-1).id, 11);
});

for (const [source, snapshot] of [['custom', custom], ['legacy toolResult', legacy]]) {
  test(`reconstructTodoState skips an entire malformed ${source} snapshot and continues replay`, async () => {
    const mod = await loadSource(new URL('../todo.ts', import.meta.url));
    const previous = [task(1, 'kept')];
    const damaged = task(2, 'must not survive');
    const cycle = {}; cycle.self = cycle;
    const invalid = [
      ['wrong task array', snapshot('bad', 3)],
      ['truncated marker', snapshot([damaged, '[truncated]'], 3)],
      ['missing task', snapshot([damaged, null], 3)],
      ['bad id', snapshot([{ ...damaged, id: 1.5 }], 3)],
      ['bad subject', snapshot([{ ...damaged, subject: 42 }], 3)],
      ['bad status', snapshot([{ ...damaged, status: 'toString' }], 3)],
      ['bad description', snapshot([{ ...damaged, description: [] }], 3)],
      ['bad activeForm', snapshot([{ ...damaged, activeForm: false }], 3)],
      ['bad owner', snapshot([{ ...damaged, owner: {} }], 3)],
      ['bad blockedBy', snapshot([{ ...damaged, blockedBy: '#1' }], 3)],
      ['bad dependency id', snapshot([{ ...damaged, blockedBy: ['1'] }], 3)],
      ['null metadata', snapshot([{ ...damaged, metadata: null }], 3)],
      ['array metadata', snapshot([{ ...damaged, metadata: [] }], 3)],
      ['cyclic metadata', snapshot([{ ...damaged, metadata: cycle }], 3)],
      ['duplicate id', snapshot([damaged, damaged], 3)],
      ['non-finite next ID', snapshot([damaged], Infinity)],
      ['reused next ID', snapshot([damaged], 2)],
    ];
    const later = [task(1, 'tombstone', { status: 'deleted' }), task(4, '', {
      description: '', activeForm: 'doing', status: 'in_progress', blockedBy: [1, 3],
      owner: 'owner', metadata: { nested: [null, { arbitrary: true }] },
    })];
    for (const [label, bad] of invalid) {
      const branch = [snapshot(previous, 2), bad];
      const { ctx } = session('replay', branch);
      mod.reconstructTodoState(ctx);
      assert.deepEqual(plain(mod.getTodos('replay')), previous, label);
      branch.push(snapshot(later, 5));
      mod.reconstructTodoState(ctx);
      assert.deepEqual(plain(mod.getTodos('replay')), later, label);
    }
    const { ctx } = session('replay', [snapshot(later, 5)]);
    mod.reconstructTodoState(ctx);
    later[1].metadata.nested[1].arbitrary = false;
    later[1].blockedBy.push(99);
    assert.equal(mod.getTodos('replay')[1].metadata.nested[1].arbitrary, true);
    assert.deepEqual([...mod.getTodos('replay')[1].blockedBy], [1, 3]);
  });
}

test('missing, empty, and stale session identities never choose another slot', async () => {
  const h = await harness();
  const parent = session('parent', [custom([task(1, 'kept')], 2)]);
  const unknown = session(undefined, [custom([task(1, 'wrong')], 2)]);
  const missingAccessor = session(undefined);
  delete missingAccessor.ctx.sessionManager.getSessionId;
  const empty = session('', [custom([task(1, 'wrong')], 2)]);
  const stale = { ctx: { get sessionManager() { throw new Error('This extension ctx is stale after session replacement or reload.'); } } };
  assert.match(h.renderCall(1), /#1/);
  await h.emit('session_start', unknown);
  await h.emit('session_start', parent);
  for (const s of [unknown, missingAccessor, empty, stale, { ctx: {} }, { ctx: undefined }]) {
    const result = await h.execute(s, { action: 'create', subject: 'must not append' });
    assert.equal(result.isError, true);
    assert.match(result.details.error, /session ID/);
    await h.emit('session_tree', s);
    await h.emit('tool_execution_end', s, { toolName: 'todo', isError: false });
    await h.emit('session_shutdown', s);
  }
  await h.command(unknown);
  assert.match(unknown.notices.at(-1)[0], /session ID/);
  assert.equal(h.appends.length, 0);
  assert.equal(parent.renders, 0);
  assert.equal(parent.widgets.length, 1);
  assert.deepEqual(await h.list(parent), [task(1, 'kept')]);
  assert.match(h.renderCall(1), /kept/);
});
