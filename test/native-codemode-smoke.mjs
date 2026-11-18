import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join, dirname, isAbsolute, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
// Explicit synthetic SDK fixture. Caller supplies an isolated HOME/agent directory.
const [sdkRoot, entry, root, expected = '1'] = process.argv.slice(2);
for (const path of [sdkRoot, entry, root]) assert.ok(typeof path === 'string' && isAbsolute(path) && normalize(path) === path && !path.includes('\0'));
assert.ok(['0', '1'].includes(expected)); assert.equal(process.env.HOME, root);
assert.equal(process.env.PI_CODING_AGENT_DIR, join(root, 'agent'));
const api=await import(pathToFileURL(join(sdkRoot,'dist/index.js')));
const { AssistantMessageEventStream }=await import(pathToFileURL(join(dirname(sdkRoot), 'pi-ai/dist/utils/event-stream.js')));
const cwd=join(root,'project'), agentDir=join(root,'agent'); await mkdir(cwd,{recursive:true});await mkdir(agentDir,{recursive:true});
const modelRuntime=await api.ModelRuntime.create({modelsPath:null,allowModelNetwork:false,refreshOnCreate:false,
 credentials:{async read(){},async list(){return[]},async modify(){assert.fail('credential write')},async delete(){assert.fail('credential delete')}},modelsStore:{async read(){},async write(){},async delete(){}}});
let providerCalls=0;for(const method of ['stream','streamSimple','complete','completeSimple'])modelRuntime[method]=()=>{providerCalls++;throw Error('unexpected transport')};
modelRuntime.registerProvider('fixture',{api:'openai-completions',baseUrl:'http://127.0.0.1:1',apiKey:'synthetic',models:[{id:'fixture',name:'fixture',reasoning:true,input:['text'],contextWindow:8192,maxTokens:128,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
const settingsManager=api.SettingsManager.inMemory({defaultTools:['+codemode'],compaction:{enabled:false},retry:{enabled:false},cacheWarming:'off',enableAnalytics:false,enableInstallTelemetry:false},{projectTrusted:false});
const events=api.createEventBus(); const nested=[];
const loader=new api.DefaultResourceLoader({cwd,agentDir,settingsManager,eventBus:events,additionalExtensionPaths:[entry],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,
 extensionFactories:[api.createCodemodeExtension({mode:'on'}),pi=>{pi.on('tool_execution_end',e=>{if(e.toolName==='todo')nested.push({parentToolCallId:e.parentToolCallId,toolCallId:e.toolCallId,isError:e.isError})})}]});
await loader.reload();assert.deepEqual(loader.getExtensions().errors,[]);
const manager=api.SessionManager.create(cwd,join(root,'sessions'));
const {session}=await api.createAgentSession({cwd,agentDir,resourceLoader:loader,sessionManager:manager,settingsManager,modelRuntime,model:modelRuntime.getModel('fixture','fixture'),thinkingLevel:'high',tools:['todo','codemode'],eventBus:events});
const errors=[];try{
 await session.bindExtensions({mode:'json',onError:e=>errors.push(e)});
 const code='text(await tools.todo({action:"create",subject:"synthetic composed task",metadata:{sample:"native-sdk"}}));';
 const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
 let rounds=0;
 session.agent.streamFunction=()=>{
  const first=rounds++===0, stream=new AssistantMessageEventStream();
  const message={role:'assistant',provider:'fixture',model:'fixture',api:'openai-completions',content:first?[{type:'toolCall',id:'outer',name:'codemode',arguments:{code}}]:[{type:'text',text:'Synthetic complete'}],stopReason:first?'toolUse':'stop',timestamp:Date.now(),usage};
  stream.push({type:'done',reason:message.stopReason,message});stream.end();return stream;
 };
 await session.prompt('Synthetic codemode fixture, no model transport',{expandPromptTemplates:false});await session.waitForIdle();
 const result=session.messages.find(message=>message.role==='toolResult'&&message.toolName==='codemode');
 assert.ok(result&&!result.isError,JSON.stringify(result));assert.ok(result.content.some(c=>c.type==='text'&&c.text.includes('Created #1')));
 assert.equal(rounds,2);assert.equal(nested.length,1);assert.equal(nested[0].parentToolCallId,'outer');assert.equal(nested[0].isError,false);
 assert.equal(result.nestedCalls.calls[0].name,'todo');assert.equal(Object.hasOwn(result.nestedCalls.calls[0],'result'),false);
 assert.equal(manager.getBranch().filter(e=>e.type==='message'&&e.message.role==='toolResult'&&e.message.toolName==='todo').length,0);
 const before=await session.agent.state.tools.find(t=>t.name==='todo').execute('read-before',{action:'list'},new AbortController().signal); assert.equal(before.details.tasks.length,1);
 const stateEntries=manager.getBranch().filter(e=>e.type==='custom'&&e.customType==='rpiv-todo-state').length;
 await session.reload();
 const after=await session.agent.state.tools.find(t=>t.name==='todo').execute('read-after',{action:'list'},new AbortController().signal);
 assert.equal(after.details.tasks.length,Number(expected));assert.equal(providerCalls,0);assert.deepEqual(errors,[]);
 const file=manager.getSessionFile();assert.ok(file); const reopened=api.SessionManager.open(file);
 assert.equal(reopened.getBranch().filter(e=>e.type==='custom'&&e.customType==='rpiv-todo-state').length,stateEntries);
 // A second SDK session uses its own runtime/append binding and never prompts.
 const childEvents=api.createEventBus();
 const childLoader=new api.DefaultResourceLoader({cwd,agentDir,settingsManager,eventBus:childEvents,additionalExtensionPaths:[entry],noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});
 await childLoader.reload();assert.deepEqual(childLoader.getExtensions().errors,[]);
 const childManager=api.SessionManager.inMemory(cwd);
 const {session:child}=await api.createAgentSession({cwd,agentDir,resourceLoader:childLoader,sessionManager:childManager,settingsManager,modelRuntime,model:modelRuntime.getModel('fixture','fixture'),tools:['todo'],eventBus:childEvents});
 const todo=(owner,id,args)=>owner.agent.state.tools.find(t=>t.name==='todo').execute(id,args,new AbortController().signal);
 try {
  assert.notEqual(childManager.getSessionId(),manager.getSessionId());
  await child.bindExtensions({mode:'json',onError:e=>errors.push(e)});
  assert.equal((await todo(child,'child-empty',{action:'list'})).details.tasks.length,0);
  const created=await todo(child,'child-create',{action:'create',subject:'synthetic child task'});
  assert.ok(!created.isError,JSON.stringify(created));assert.equal(created.details.tasks[0].id,1);
  await child.reload();
  const childTasks=(await todo(child,'child-list',{action:'list'})).details.tasks;
  assert.deepEqual(childTasks.map(t=>t.subject),['synthetic child task']);
  assert.equal(childManager.getBranch().filter(e=>e.type==='custom'&&e.customType==='rpiv-todo-state').length,1);
  assert.deepEqual((await todo(session,'parent-list',{action:'list'})).details.tasks,after.details.tasks);
  assert.equal(manager.getBranch().filter(e=>e.type==='custom'&&e.customType==='rpiv-todo-state').length,stateEntries);
 } finally { child.dispose(); }
 assert.equal(providerCalls,0);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({sdk:JSON.parse(await readFile(join(sdkRoot,'package.json'),'utf8')).version,actualCodemode:true,nativeNestedCalls:nested.length,before:before.details.tasks.length,afterReload:after.details.tasks.length,stateEntries,diskReopen:true,twoSessionsIsolated:true,providerCalls,sdkSyntheticPromptCalls:1,syntheticStreamRounds:rounds,entry}));
}finally{session.dispose()}
