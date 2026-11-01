export function ownershipLabel(assignment,now=Date.now()) {
 if(!assignment?.owner_id)return 'Unassigned';
 if(assignment.state==='revision_changed')return 'Revision changed';
 if(assignment.state==='expired'||!Number.isFinite(Date.parse(assignment.expires_at))||Date.parse(assignment.expires_at)<=now)return 'Ownership expired';
 return 'Owned';
}
export function notificationLink(item) {
 const query=new URLSearchParams({kind:item.kind,search:item.resource_id,focus:item.resource_id,connector:item.connector_id||'',source:item.source||''});
 return '/respond/inbox?'+query;
}
