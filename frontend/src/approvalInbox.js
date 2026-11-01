// Presentation only: owner APIs recheck permissions, revisions, scope and expiry.
export function inboxKey(item) {
 return JSON.stringify([item.kind,item.id,item.document?.connector_id||'',item.document?.source||'']);
}
export function expiryState(item, now=Date.now()) {
 if(!item.expires_at)return {label:'No expiry set',expired:false};
 const time=Date.parse(item.expires_at);
 if(!Number.isFinite(time))return {label:'Expiry unavailable',expired:true};
 const expired=time<=now;
 return {label:expired?'Expired':time-now<=3600000?'Expires within 1 hour':'Valid until',expired};
}
export function handoff(item,session,now=Date.now()) {
 const doc=item.document||{};
 const expired=expiryState(item,now).expired;
 const role=item.kind==='respond'&&item.stage==='execution'&&!expired?'executor':item.kind==='memory'&&expired?'proposer':'approver';
 const authors=[doc.created_by,...(doc.proposal_authors||[])].filter(Boolean);
 const actor=session?.operator_id;
 let reason=role==='executor'?'An independent executor must preview and confirm this exact mock target.':role==='proposer'?'An author must update the expired validity window, then request independent review.':'An independent approver must review the saved revision and evidence.';
 const independent=role==='proposer'||(authors.length>0&&!authors.includes(actor)&&(role!=='executor'||actor!==doc.approved_by));
 const eligible=Boolean(actor&&session?.roles?.includes(role)&&independent);
 if(!eligible)reason+=` Hand off to a different operator with the ${role} role.`;
 if(item.kind==='respond'&&doc.stopped)reason+=' The sandbox execution gate is stopped.';
 return {role,eligible,reason};
}
