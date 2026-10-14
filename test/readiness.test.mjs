import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource, theme } from './helpers/source-vm.mjs';
const api = () => loadSource(new URL('../todo.ts',import.meta.url));
const state = {tasks:[{id:1,subject:'done',status:'completed'},{id:2,subject:'ready',status:'pending',blockedBy:[1]},{id:3,subject:'blocked',status:'pending',blockedBy:[2]},{id:4,subject:'gone',status:'deleted'},{id:5,subject:'deleted dep',status:'pending',blockedBy:[4]},{id:6,subject:'missing dep',status:'pending',blockedBy:[99]},{id:7,subject:'working',status:'in_progress'}],nextId:8};
test('only completed dependencies satisfy readiness; inspection never mutates', async () => {
  const a=await api();const before=JSON.stringify(state);assert.deepEqual([...a.readyTasks(state.tasks)].map(t=>t.id),[2]);
  assert.deepEqual([...a.unresolvedDependencies(state.tasks[2],state.tasks)],[2]);assert.equal(JSON.stringify(state),before);
});
test('list hints completed dependencies no longer waiting, deleted/missing remain blocked', async () => {
  const a=await api();const text=a.applyTaskMutation(state,'list',{}).content[0].text;
  assert.match(text,/#2 ready \[ready to start\]/);assert.match(text,/#3 blocked.*waiting on #2/);assert.match(text,/#5 deleted dep.*#4/);assert.match(text,/#6 missing dep.*#99/);
});
test('ready command is read-only after replay, empty result and invalid arg', async () => {
  const a=await api();a.reconstructTodoState({sessionManager:{getBranch:()=>[{type:'message',message:{role:'toolResult',toolName:'todo',details:state}}]}});
  let command;const notices=[];a.registerTodosCommand({registerCommand:(_n,c)=>command=c});const ctx={hasUI:true,ui:{notify:(m,l)=>notices.push([m,l])}};
  await command.handler('ready',ctx);assert.match(notices.at(-1)[0],/#2 ready/);assert.ok(!notices.at(-1)[0].includes('#3'));
  await command.handler('oops',ctx);assert.equal(notices.at(-1)[1],'warning');assert.equal(a.getTodos()[1].status,'pending');
});
test('tree and compaction restore next ID and lifecycle handlers use current branch', async () => {
  const a=await loadSource(new URL('../index.ts',import.meta.url));const hooks=new Map();let tool;
  a.default({registerTool:t=>tool=t,registerCommand(){},on:(n,f)=>hooks.set(n,f)});
  const ctx={hasUI:false,sessionManager:{getBranch:()=>[{type:'message',message:{role:'toolResult',toolName:'todo',details:{tasks:[{id:10,subject:'restored',status:'pending'}],nextId:11}}}]}};
  for(const event of ['session_start','session_compact','session_tree']) {
    await hooks.get(event)({},ctx);const r=await tool.execute('id',{action:'create',subject:'new'},undefined,undefined,ctx);assert.equal(r.details.tasks.at(-1).id,11);
  }
});
test('overflow prioritizes a current task late in insertion order', async () => {
  const a=await loadSource(new URL('../index.ts',import.meta.url));const hooks=new Map();let tool,widget;
  a.default({registerTool:t=>tool=t,registerCommand(){},on:(n,f)=>hooks.set(n,f)});
  const ctx={hasUI:true,sessionManager:{getBranch:()=>[]},ui:{setWidget:(_k,f)=>{if(f)widget=f({requestRender(){}},theme)}}};
  await hooks.get('session_start')({},ctx);for(let i=0;i<20;i++)await tool.execute('id',{action:'create',subject:'pending'+i},undefined,undefined,ctx);
  await tool.execute('id',{action:'update',id:20,status:'in_progress',subject:'CURRENT'},undefined,undefined,ctx);await hooks.get('tool_execution_end')({toolName:'todo'},ctx);
  assert.ok(widget.render(80).join('\n').includes('CURRENT'));assert.ok(widget.render(80).length<=12);
});
