import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource, theme } from './helpers/source-vm.mjs';
import { visibleWidth } from '@earendil-works/pi-tui';
const api = () => loadSource(new URL('../todo.ts',import.meta.url));
const plain = x => JSON.parse(JSON.stringify(x));
const ctx = tasks => ({ sessionManager:{getBranch:()=>tasks} });
const snapshot = (tasks,nextId=tasks.length+1) => ({type:'message',message:{role:'toolResult',toolName:'todo',details:{tasks,nextId}}});
test('baseline reducer creates pending IDs, immutable mutations and metadata deletion', async () => {
  const a=await api(); const original={tasks:[],nextId:1};
  const r=a.applyTaskMutation(original,'create',{subject:'A',metadata:{x:1}}); assert.equal(r.state.tasks[0].status,'pending'); assert.equal(original.tasks.length,0);
  const u=a.applyTaskMutation(r.state,'update',{id:1,status:'in_progress',metadata:{x:null,y:2}});
  assert.deepEqual(plain(u.state.tasks[0].metadata),{y:2}); assert.equal(r.state.tasks[0].status,'pending');
});
test('baseline all state transition pairs', async () => {
  const a=await api();const allowed={pending:['pending','in_progress','completed','deleted'],in_progress:['pending','in_progress','completed','deleted'],completed:['completed','deleted'],deleted:['deleted']};
  for(const from of Object.keys(allowed))for(const to of Object.keys(allowed)) assert.equal(a.isTransitionValid(from,to),allowed[from].includes(to),`${from} -> ${to}`);
});
test('baseline dependency errors and cycle preserve exact old state', async () => {
  const a=await api();const state={tasks:[{id:1,subject:'A',status:'pending'},{id:2,subject:'B',status:'pending',blockedBy:[1]},{id:3,subject:'gone',status:'deleted'}],nextId:4};
  for(const params of [{id:1,addBlockedBy:[2]},{id:1,addBlockedBy:[1]},{id:1,addBlockedBy:[999]},{id:1,addBlockedBy:[3]},{id:1}]) {
    const r=a.applyTaskMutation(state,'update',params);assert.ok(r.details.error);assert.equal(r.state,state);
  }
  assert.equal(a.detectCycle(state.tasks,1,[2]),true);assert.equal(a.detectCycle(state.tasks,2,[1]),false);
});
test('baseline list/get/delete/clear and additive dependencies', async () => {
  const a=await api();let state={tasks:[],nextId:1};
  for(const subject of ['A','B'])state=a.applyTaskMutation(state,'create',{subject}).state;
  state=a.applyTaskMutation(state,'update',{id:2,addBlockedBy:[1]}).state;
  assert.match(a.applyTaskMutation(state,'get',{id:1}).content[0].text,/blocks: #2/);
  state=a.applyTaskMutation(state,'update',{id:2,removeBlockedBy:[1]}).state;assert.equal(state.tasks[1].blockedBy,undefined);
  state=a.applyTaskMutation(state,'delete',{id:1}).state;assert.ok(!a.applyTaskMutation(state,'list',{}).content[0].text.includes('#1'));
  assert.ok(a.applyTaskMutation(state,'list',{includeDeleted:true}).content[0].text.includes('#1'));
  assert.deepEqual(plain(a.applyTaskMutation(state,'clear',{}).state),{tasks:[],nextId:1});
});
test('baseline replay uses current branch latest snapshot only and reload is repeatable', async () => {
  const a=await api();const entries=[snapshot([{id:1,subject:'old',status:'pending'}]),{type:'custom',data:'ignored'},snapshot([{id:9,subject:'current',status:'in_progress'}],10)];
  a.reconstructTodoState(ctx(entries));assert.equal(a.getTodos()[0].subject,'current');
  a.reconstructTodoState(ctx(entries));assert.equal(a.getTodos().length,1);
  a.reconstructTodoState(ctx([]));assert.equal(a.getTodos().length,0);
});
test('baseline overlay reads live state, drops completed first, rebinds and disposes', async () => {
  // Load index once so reducer and overlay share the same module instance.
  const mod=await loadSource(new URL('../index.ts',import.meta.url));let tool;const hooks=new Map();const widgets=[];let widget,renders=0;
  mod.default({registerTool:t=>tool=t,registerCommand(){},on:(n,f)=>hooks.set(n,f)});
  const ui={setWidget:(key,factory)=>{widgets.push({key,factory});if(factory)widget=factory({requestRender:()=>renders++},theme)}};
  const c={...ctx([]),hasUI:true,ui};await hooks.get('session_start')({},c);
  for(let i=0;i<15;i++) await tool.execute('id',{action:'create',subject:'任务🙂 '+i},undefined,undefined,c);
  await tool.execute('id',{action:'update',id:1,status:'completed'},undefined,undefined,c);
  await hooks.get('tool_execution_end')({toolName:'todo',isError:false},c);
  for(const width of [3,12,80]) {const lines=widget.render(width);assert.ok(lines.length<=12);for(const line of lines)assert.ok(visibleWidth(line)<=width);}
  assert.ok(!widget.render(80).join('\n').includes('任务🙂 0'));
  await tool.execute('id',{action:'update',id:2,subject:'fresh'},undefined,undefined,c);assert.ok(widget.render(80).join('\n').includes('fresh'));
  await hooks.get('tool_execution_end')({toolName:'todo',isError:false},c);assert.ok(renders>0);
  await hooks.get('session_start')({}, {...c,ui:{...ui}}); // empty branch: no stale tasks
  await hooks.get('session_shutdown')();assert.equal(widgets.at(-1).factory,undefined);
});
