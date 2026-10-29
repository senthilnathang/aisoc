import { readFile } from "node:fs/promises";
import { argumentsFor, output } from "../backend-parity/harness.mjs";
const options=argumentsFor();
if(!options.before || !options.after)throw Error("Use --before baseline.json --after candidate.json");
const [before,after]=await Promise.all([options.before,options.after].map(async path=>JSON.parse(await readFile(path,"utf8"))));
for(const campaign of [before,after]) {
  if(!Array.isArray(campaign.reports) || !campaign.reports.length)throw Error("Campaign must contain measured reports.");
  for(const row of campaign.reports) {
    if(!row.operations || !Object.keys(row.operations).length)throw Error("Per-operation latency measurements are required.");
    for(const latency of [row.latency,...Object.values(row.operations)]) {
      if(!latency || ['p50_ms','p95_ms','p99_ms'].some(key=>!Number.isFinite(latency[key]) || latency[key]<0))throw Error("Latency measurements must be finite nonnegative numbers.");
    }
  }
}
if(before.fixture_fingerprint!==after.fixture_fingerprint)throw Error("Workload fingerprints differ; do not compare different workloads.");
if([...before.reports,...after.reports].some(row=>row.error_count || row.resources?.sampling_error))throw Error("Failed requests or resource sampling errors invalidate this comparison.");
const median=values=>{const sorted=values.sort((a,b)=>a-b);const mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;};
const rows=[];
const operationRows=[];
for(const size of new Set(before.reports.map(row=>row.size))) {
  const a=before.reports.filter(row=>row.size===size),b=after.reports.filter(row=>row.size===size);
  if(!a.length || a.length!==b.length)throw Error("Repeat counts differ for "+size);
  const operations=Object.keys(a[0].operations).sort().join(',');
  if([...a,...b].some(row=>Object.keys(row.operations).sort().join(',')!==operations))throw Error("Operation sets differ for "+size);
  const metrics={throughput_rps:row=>row.successful_rps,p95_ms:row=>row.latency.p95_ms,p99_ms:row=>row.latency.p99_ms,cpu_ms:row=>row.resources?.cpu_ms,peak_rss_bytes:row=>row.resources?.sampled_peak_rss_bytes,peak_pss_bytes:row=>row.resources?.sampled_peak_pss_bytes};
  for(const [metric,extract] of Object.entries(metrics)) {
    if([...a,...b].some(row=>extract(row)==null)){rows.push({size,metric,available:false});continue;}
    const old=median(a.map(extract)),current=median(b.map(extract));
    rows.push({size,metric,before:old,after:current,change_percent:old?(current-old)/old*100:null});
  }
  for(const operation of Object.keys(a[0].operations)) {
    for(const metric of ['p50_ms','p95_ms','p99_ms']) {
      const old=median(a.map(row=>row.operations[operation][metric]));
      const current=median(b.map(row=>row.operations[operation][metric]));
      operationRows.push({size,operation,metric,before:old,after:current,change_percent:old?(current-old)/old*100:null});
    }
  }
}
if(new Set(before.reports.map(row=>row.size)).size!==new Set(after.reports.map(row=>row.size)).size)throw Error("Dataset sizes differ.");
const regressions=operationRows.filter(row=>row.metric!=='p50_ms' && row.change_percent>10);
await output(options.output||"output/backend-performance/comparison.json",{before:before.label,after:after.label,rows,operation_rows:operationRows,latency_regressions_over_10_percent:regressions,latency_gate_passed:regressions.length===0,warning:"Descriptive comparison only. Check environment, database/worker resource scope, worker configuration, and competing load before attributing differences to backend language. The latency flag checks median per-operation p95/p99 only, not the full release gate."});
