import { activeItem, sectionForView } from './navigation.js';
const detail = {
 huntDetail: {resource:"hunts",key:"huntId",label:"Hunt"},
 investigationDetail: {resource:'investigations',key:'investigationId',label:'Investigation'},
 detectionRuleDetail: {resource:'detection-rules',key:'ruleId',label:'Rule'},
 threatIntelDetail: {resource:'threat-intel',key:'reportId',label:'Report'},
 skillDetail: {resource:'skills',key:'skillId',label:'Skill'},
};
export function breadcrumbModel(view, ids) {
 const section=sectionForView(view), parent=section.items.find(item=>item.view===activeItem(view)) || section.items[0];
 const items=[{label:section.label,view:section.items[0].view},{label:parent.label,view:parent.view}];
 const resource=detail[view];
 let lookup=null;
 if(resource){items.push({label:resource.label});if(ids[resource.key])lookup={resource:resource.resource,id:ids[resource.key]};}
 else if(view==='skillCreate')items.push({label:'Create skill'});
 return {items,lookup};
}
