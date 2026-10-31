// API resource names and browser route names differ for threat reports.
export function changedResource(path, method) {
 if(!['PATCH','PUT','DELETE'].includes(method))return null;
 const match=path.match(/^\/(investigations|detection-rules|threat-intel-reports|skills)\/([^/?]+)$/);
 if(!match)return null;
 try{return {resource:match[1]==='threat-intel-reports'?'threat-intel':match[1],id:decodeURIComponent(match[2])};}
 catch{return null;}
}
