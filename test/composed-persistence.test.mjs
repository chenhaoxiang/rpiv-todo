import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource } from './helpers/source-vm.mjs';

const entry = new URL('../todo.ts', import.meta.url);
const plain = value => JSON.parse(JSON.stringify(value));
async function harness(branch = []) {
  const api = await loadSource(entry); let tool, next = branch.length + 1;
  const handlers = new Map();
  const ctx = { sessionManager: { getBranch: () => branch, getLeafId: () => branch.at(-1)?.id ?? null } };
  const pi = { registerTool(value) { tool = value; }, on(name, callback) {
    const callbacks = handlers.get(name) ?? []; callbacks.push(callback); handlers.set(name, callbacks);
  }, appendEntry(customType, data) {
    branch.push({ id: `entry-${next++}`, type: 'custom', customType, data: plain(data) });
  } };
  api.registerTodoTool(pi);
  api.reconstructTodoState(ctx);
  return { api, tool, ctx, branch, pi, async nested(id, args) {
    for (const handler of handlers.get('tool_call') ?? []) await handler({toolName:'todo',toolCallId:id,parentToolCallId:'outer',input:args}, ctx);
    const result = await tool.execute(id, args, undefined, undefined, ctx);
    for (const handler of handlers.get('tool_execution_end') ?? []) await handler({toolName:'todo',toolCallId:id,parentToolCallId:'outer',result,isError:!!result.isError}, ctx);
    return result;
  }, async restoreFresh() {
    const fresh = await loadSource(entry); fresh.reconstructTodoState(ctx); return fresh;
  } };
}
function parentResult(branch, calls) {
  // Native Pi records nested call metadata, NOT each nested AgentToolResult.details.
  // Deliberately irrelevant text: replay must never parse the outer tool body.
  branch.push({ id: `outer-${branch.length}`, type: 'message', message: {
    role: 'toolResult', toolName: 'codemode', toolCallId: 'outer', content: [{type:'text',text:'COMPOSED_OUTPUT_NOT_A_TASK_SNAPSHOT'}],
    nestedCalls: { complete: true, calls: calls.map((arguments_, i) => ({ id:`outer/${i+1}`, name:'todo', status:'ok', arguments:arguments_ })) },
  } });
}

test('composed create survives current-branch reconstruction without a direct todo toolResult', async () => {
  const h = await harness(), args = { action:'create', subject:'nested task', metadata:{ phase:'synthetic' } };
  const result = await h.nested('outer/1', args);
  assert.equal(result.isError, undefined); assert.equal(h.api.getTodos().length, 1);
  parentResult(h.branch, [args]);
  const restored = await h.restoreFresh();
  assert.deepEqual(plain(restored.getTodos()), plain(result.details.tasks));
});

test('composed update and dependency IDs survive reload after legacy direct snapshots', async () => {
  const h = await harness([{id:'legacy',type:'message',message:{role:'toolResult',toolName:'todo',toolCallId:'direct',details:{tasks:[{id:1,subject:'legacy',status:'pending'}],nextId:2}}}]);
  const update = { action:'update', id:1, status:'in_progress' };
  await h.nested('outer/1', update);
  const created = await h.nested('outer/2', {action:'create',subject:'dependent',blockedBy:[1]});
  parentResult(h.branch, [update, {action:'create',subject:'dependent',blockedBy:[1]}]);
  const restored = await h.restoreFresh();
  assert.deepEqual(plain(restored.getTodos()), plain(created.details.tasks));
  let tool; restored.registerTodoTool({registerTool:t=>tool=t,appendEntry(){}});
  const next = await tool.execute('direct-next',{action:'create',subject:'next'},undefined,undefined,h.ctx);
  assert.equal(next.details.tasks.at(-1).id,3);
});

test('owner checkpoint order wins over delayed direct result projections', async () => {
  const h = await harness();
  const first = await h.tool.execute('direct-1',{action:'create',subject:'A'},undefined,undefined,h.ctx);
  const second = await h.nested('outer/1',{action:'create',subject:'B',blockedBy:[1]});
  h.branch.push({id:'late-direct',type:'message',message:{role:'toolResult',toolName:'todo',...plain(first)}});
  const restored = await h.restoreFresh();
  assert.deepEqual(plain(restored.getTodos()), plain(second.details.tasks));
  assert.equal(first.details.stateSource,'native-entry-v1');
});

test('clear, tombstones and current-branch-only replay retain the exact next ID', async () => {
  const h = await harness();
  await h.nested('outer/1',{action:'create',subject:'A'});
  const prefix = plain(h.branch);
  await h.nested('outer/2',{action:'delete',id:1});
  assert.equal((await h.restoreFresh()).getTodos()[0].status,'deleted');
  await h.nested('outer/3',{action:'clear'});
  const cleared = await h.restoreFresh(); assert.equal(cleared.getTodos().length,0);
  let tool;cleared.registerTodoTool({registerTool:t=>tool=t,appendEntry(){}});
  const reset=await tool.execute('after-clear',{action:'create',subject:'new'},undefined,undefined,h.ctx);
  assert.equal(reset.details.tasks[0].id,1);
  const fork = await harness(prefix);
  assert.equal(fork.api.getTodos()[0].status,'pending');
  const added=await fork.nested('fork/1',{action:'create',subject:'branch B'});
  assert.equal(added.details.tasks.at(-1).id,2); assert.equal((await h.restoreFresh()).getTodos().length,0);
});

test('read operations and rejected mutations do not append checkpoints or relax invariants', async () => {
  const h=await harness(); await h.nested('outer/1',{action:'create',subject:'A'});
  const count=h.branch.length;
  for(const args of [{action:'list'},{action:'get',id:1},{action:'create',subject:' '},{action:'update',id:1,addBlockedBy:[1]},{action:'update',id:999,status:'completed'}]) await h.nested('outer/read',args);
  assert.equal(h.branch.length,count);
  await h.nested('outer/2',{action:'update',id:1,status:'completed'});
  const reopen=await h.nested('outer/3',{action:'update',id:1,status:'in_progress'});
  assert.equal(reopen.isError,true);assert.equal((await h.restoreFresh()).getTodos()[0].status,'completed');
});

test('checkpoints detach caller metadata and returned snapshots', async () => {
  const h=await harness();const metadata={deep:{value:'original'}};
  const result=await h.nested('outer/1',{action:'create',subject:'A',metadata});
  metadata.deep.value='changed';result.details.tasks[0].subject='returned mutation';
  const restored=await h.restoreFresh();
  assert.equal(restored.getTodos()[0].metadata.deep.value,'original');assert.equal(restored.getTodos()[0].subject,'A');
});

test('native append failure is explicit, keeps allocated IDs and never advises blind replay', async () => {
  const h=await harness();h.pi.appendEntry=()=>{throw Error('PRIVATE_PATH_OR_BACKEND_ERROR')};
  const failed=await h.nested('outer/1',{action:'create',subject:'volatile'});
  assert.equal(failed.isError,true);assert.match(failed.details.error,/persistence is unconfirmed/);
  assert.ok(!JSON.stringify(failed).includes('PRIVATE_PATH_OR_BACKEND_ERROR'));assert.equal(h.api.getTodos().length,1);
  const list=await h.nested('outer/list',{action:'list'});assert.equal(list.details.tasks[0].id,1);
  const later=await h.nested('outer/2',{action:'create',subject:'another'});assert.equal(later.details.tasks.at(-1).id,2);
  assert.equal(h.branch.length,0); // no claim that volatile state survived restart
});

test('a partially successful append survives replay even though the tool reports uncertainty', async () => {
  const h=await harness();const append=h.pi.appendEntry;
  h.pi.appendEntry=(...args)=>{append(...args);throw Error('after append')};
  const result=await h.nested('outer/1',{action:'create',subject:'retained'});
  assert.equal(result.isError,true);assert.equal((await h.restoreFresh()).getTodos()[0].subject,'retained');
});

test('missing native persistence and non-JSON state refuse before mutation, without leaking bad params', async () => {
  const h=await harness();const append=h.pi.appendEntry;h.pi.appendEntry=undefined;
  const missing=await h.nested('outer/1',{action:'create',subject:'no persistence'});
  assert.equal(missing.isError,true);assert.equal(h.api.getTodos().length,0);
  h.pi.appendEntry=append;const cycle={};cycle.self=cycle;
  const invalid=await h.nested('outer/2',{action:'create',subject:'not stored',metadata:cycle});
  assert.equal(invalid.isError,true);assert.doesNotThrow(()=>JSON.stringify(invalid));
  assert.equal(h.api.getTodos().length,0);assert.equal(h.branch.length,0);
});

test('unrelated, future and malformed custom entries cannot supply a task state', async () => {
  const h=await harness();await h.nested('outer/1',{action:'create',subject:'valid'});
  const data={version:1,tasks:[{id:99,subject:'wrong',status:'completed'}],nextId:100};
  h.branch.push({type:'custom',customType:'other',data},{type:'custom',customType:h.api.TODO_STATE_ENTRY,data:{...data,version:2}},{type:'custom',customType:h.api.TODO_STATE_ENTRY,data:{version:1,tasks:'bad',nextId:2}});
  assert.equal((await h.restoreFresh()).getTodos()[0].subject,'valid');
});
