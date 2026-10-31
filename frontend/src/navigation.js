// Single source of truth for section ownership, links and active states.
export const sections = [
  { label: 'Detect', items: [{view:'queue',label:'Overview',path:'/'},{view:'detect',label:'Rule registry',path:'/detect/rules'},{view:'detectionIntelligence',label:'Intelligence',path:'/detect/intelligence'},{view:'detectionCoverage',label:'Coverage',path:'/detect/coverage'},{view:'detectionRouting',label:'Routing',path:'/detect/routing'}] },
  { label: 'Investigate', items: [{view:'investigations',label:'Investigations',path:'/investigations'}] },
  { label: 'Respond', items: [
    {view:'respond',label:'Overview',path:'/respond'},
    {view:'responseCases',label:'Cases',path:'/respond/cases'},
    {view:'responseActions',label:'Actions',path:'/respond/actions'},
    {view:'responseApprovals',label:'Approvals',path:'/respond/approvals'},
    {view:'responseWorkflows',label:'Workflows',path:'/respond/workflows'},
    {view:'responseRunbooks',label:'Runbooks',path:'/respond/runbooks'},
    {view:'responseActivity',label:'Activity',path:'/respond/activity'},
  ] },
  { label:'Hunt',items:[{view:'hunt',label:'Hunt workspace',path:'/hunt'}] },
  { label:'Threat Intel',items:[{view:'threatIntel',label:'Reports',path:'/threat-intel'}] },
  { label:'Skills',items:[{view:'skills',label:'Library',path:'/skills'},{view:'skillTemplates',label:'Starter templates',path:'/skills/templates'},{view:'skillSuggestions',label:'Environment suggestions',path:'/skills/suggestions'},{view:'skillOutcomes',label:'Outcomes',path:'/skills/outcomes'}] },
  { label:'Memory',items:[{view:'memory',label:'Investigation memory',path:'/memory'}] },
  { label:'Build',items:[{view:'apiSources',label:'API sources',path:'/build/api-sources'},{view:'streamOperations',label:'Stream operations',path:'/build/stream-operations'},{view:'connector',label:'Connectors',path:'/build/connectors/cribl'}] },
];
const parentView = { investigationDetail:'investigations', detectionRuleDetail:'detect', threatIntelDetail:'threatIntel', skillCreate:'skills', skillDetail:'skills' };
export const activeItem = view => parentView[view] || view;
export const sectionForView = view => sections.find(section=>section.items.some(item=>item.view===activeItem(view))) || sections[0];
export const pathForView = Object.fromEntries([...sections.flatMap(section=>section.items.map(item=>[item.view,item.path])),['skillCreate','/skills/new']]);
