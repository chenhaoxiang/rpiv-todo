import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSource,theme} from './helpers/source-vm.mjs';
async function toolHarness(){const a=await loadSource(new URL('../todo.ts',import.meta.url));let tool;a.registerTodoTool({registerTool:t=>tool=t});return{a,tool};}
test('rejected transition carries error flag and never displays its requested state',async()=>{
 const h=await toolHarness();await h.tool.execute('create',{action:'create',subject:'A'},undefined,undefined,{});
 await h.tool.execute('done',{action:'update',id:1,status:'completed'},undefined,undefined,{});
 const r=await h.tool.execute('bad',{action:'update',id:1,status:'in_progress'},undefined,undefined,{});
 assert.equal(r.isError,true);assert.match(r.details.error,/illegal transition/);assert.equal(h.a.getTodos()[0].status,'completed');
 const rendered=h.tool.renderResult(r,{},theme,{}).render(80).join('');assert.match(rendered,/✗/);assert.ok(!rendered.includes('in progress'));
});
for(const params of [{action:'get',id:999},{action:'update',id:999,status:'completed'},{action:'create',subject:' '}])test(`validation rejection is explicit: ${JSON.stringify(params)}`,async()=>{
 const h=await toolHarness();const r=await h.tool.execute('bad',params,undefined,undefined,{});assert.equal(r.isError,true);assert.ok(r.details.error);assert.equal(h.a.getTodos().length,0);
});
test('renderer recognizes legacy details.error even without isError',async()=>{
 const h=await toolHarness();const r={content:[],details:{action:'update',params:{id:1,status:'in_progress'},tasks:[{id:1,subject:'A',status:'completed'}],nextId:2,error:'legacy rejected'}};
 assert.match(h.tool.renderResult(r,{},theme,{}).render(80).join(''),/✗/);
});
test('successful updates render actual returned snapshot state, not a request hint',async()=>{
 const h=await toolHarness();const r=await h.tool.execute('create',{action:'create',subject:'A'},undefined,undefined,{});assert.ok(!r.isError);
 const staleHint={content:[],details:{action:'update',params:{id:1,status:'in_progress'},tasks:[{id:1,subject:'A',status:'completed'}],nextId:2}};
 assert.match(h.tool.renderResult(staleHint,{},theme,{}).render(80).join(''),/completed/);
});
