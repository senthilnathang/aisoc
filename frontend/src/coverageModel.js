export const coverageStates=['unassessed','gap','covered','accepted_risk','alternative_control','not_applicable'];
export const stateLabel=value=>({unassessed:'Unassessed',gap:'Coverage gap',covered:'Analyst-verified coverage',accepted_risk:'Accepted risk',alternative_control:'Alternative control',not_applicable:'Not applicable',expired:'Review expired',stale:'Rule changed / stale'}[value]||value);
export function radarPoint(index,count,radius,value=100) {
 const angle=-Math.PI/2+Math.PI/count+index*2*Math.PI/count;
 const scale=Math.max(0,Math.min(100,Number(value)||0))/100;
 return {x:400+Math.cos(angle)*radius*scale,y:350+Math.sin(angle)*radius*scale};
}
export const radarPoints=(rows,radius,key)=>rows.map((row,index)=>{const p=radarPoint(index,rows.length,radius,key?row[key]:100);return `${p.x},${p.y}`;}).join(' ');
