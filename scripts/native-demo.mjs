// Public product visual: synthetic data only; no daemon, files, or real sessions.
import { startAdminServer } from '../dist/admin/server.js';
import { layoutActions } from '../dist/deck/layout.js';
const workflows = ['Review', 'Tests', 'Debug', 'Refactor', 'Status', 'Do it'].map(name => ({ id: name === 'Do it' ? 'do-it' : name.toLowerCase(), name, prompt: name === 'Do it' ? 'lets do it' : `${name} the current changes.` }));
const slots = ['Build the dashboard', 'Review the API', 'Polish onboarding', 'Write release notes', 'Explore next steps', 'Plan the roadmap', 'Check accessibility'].map((label,index) => ({ index, label, sessionId: `demo-task-${index+1}`, cwd: '~/Projects/demo', state: ['running','thinking','done','idle','idle','idle','done'][index], detail: index === 0 ? 'Building the next version of the dashboard' : 'Illustrative demo task', lastMessage: index === 0 ? 'The layout is in place. I’m checking the details before the next step.' : '', updatedAt: Date.now() }));
const status = { selectedIndex:0, harness:'Codex', surface:'marketplace', slots, workflows,
  capabilities:{mode:'live',label:'Live control',reason:'Connected to your local Codex tasks.',canNavigateSessions:true,canConfigure:true,canControlSessions:true,canListSessions:true},
  health:{overall:'ready',components:Object.fromEntries(['bridge','surface','plugin','codexDesktop','sharedControl','bindings'].map(k=>[k,{state:'ready',message:'Connected'}]))},
  desktop:{state:'connected',sessionsReady:true,message:'Connected'},
  deck:{mode:'awake',settings:{brightness:70,autoSleep:{enabled:true,timeoutMinutes:15},sleepKey:'sleep'},layout:[...layoutActions(workflows)].map(([keyIndex,action])=>({keyIndex,action})),attention:[],autoSleepDueAt:null},
};
const server = await startAdminServer(17539, async cmd => {
 if(cmd==='status') return status;
 if(cmd==='workflows.get') return {active:workflows,library:[]};
 if(cmd==='sessions') return slots.map(s=>({id:s.sessionId,name:s.label,cwd:s.cwd}));
 throw new Error('Demo is read-only');
});
console.log(server.url);
