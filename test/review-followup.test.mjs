import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource,theme } from './helpers/source-vm.mjs';
test('widget and full todos show exact readiness and waiting hints',async()=>{
 const a=await loadSource(new URL('../index.ts',import.meta.url));const hooks=new Map();let tool,command,widget;const notices=[];
 a.default({registerTool:t=>tool=t,registerCommand:(_n,c)=>command=c,on:(n,f)=>hooks.set(n,f)});
 const ctx={hasUI:true,sessionManager:{getBranch:()=>[]},ui:{notify:m=>notices.push(m),setWidget:(_k,f)=>{if(f)widget=f({requestRender(){}},theme)}}};
 await hooks.get('session_start')({},ctx);
 for(const p of [{action:'create',subject:'A'},{action:'create',subject:'B',blockedBy:[1]}])await tool.execute('id',p,undefined,undefined,ctx);
 await hooks.get('tool_execution_end')({toolName:'todo'},ctx);const view=widget.render(80).join('\n');
 assert.match(view,/1 ready/);assert.match(view,/\[ready\]/);assert.match(view,/waiting #1/);
 await command.handler('',ctx);assert.match(notices.at(-1),/1 ready to start/);assert.match(notices.at(-1),/waiting on #1/);
 await tool.execute('id',{action:'update',id:1,status:'completed'},undefined,undefined,ctx);
 await command.handler('ready',ctx);assert.match(notices.at(-1),/#2 B/);
 await tool.execute('id',{action:'delete',id:1},undefined,undefined,ctx);
 await command.handler('ready',ctx);assert.match(notices.at(-1),/No pending tasks/);
});
