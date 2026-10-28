"use strict";

const incidents = [
  { id: "INV-4821", title: "Suspicious OAuth consent grant", source: "Microsoft 365", severity: "critical", status: "Investigating", owner: "AISOC Agent", age: "4m", entity: "j.park@nova.example", score: 94 },
  { id: "INV-4819", title: "Impossible travel with token reuse", source: "Okta", severity: "high", status: "Contained", owner: "Maya Chen", age: "18m", entity: "a.santos@nova.example", score: 87 },
  { id: "INV-4814", title: "Encoded PowerShell spawned by Excel", source: "CrowdStrike", severity: "high", status: "Investigating", owner: "AISOC Agent", age: "43m", entity: "FIN-LT-044", score: 82 },
  { id: "INV-4808", title: "Unusual S3 bulk object access", source: "AWS GuardDuty", severity: "medium", status: "Triage", owner: "Noah Reed", age: "1h", entity: "svc-data-export", score: 71 },
  { id: "INV-4797", title: "Domain contacted after phishing click", source: "Zscaler", severity: "medium", status: "Contained", owner: "AISOC Agent", age: "3h", entity: "mkting-22", score: 66 },
  { id: "INV-4788", title: "Privileged role assigned outside change window", source: "Azure AD", severity: "low", status: "Resolved", owner: "Priya Shah", age: "6h", entity: "cloud-admin-temp", score: 41 }
];

const connectors = [
  { name: "CrowdStrike Falcon", type: "Endpoint detection", events: "18.4M", health: "Healthy", icon: "CF" },
  { name: "Microsoft Sentinel", type: "SIEM and analytics", events: "8.2M", health: "Healthy", icon: "MS" },
  { name: "Okta", type: "Identity provider", events: "2.7M", health: "Healthy", icon: "OK" },
  { name: "AWS GuardDuty", type: "Cloud workload", events: "940K", health: "Degraded", icon: "AW" },
  { name: "Zscaler", type: "Secure web gateway", events: "12.1M", health: "Healthy", icon: "ZS" },
  { name: "Palo Alto Networks", type: "Network security", events: "6.8M", health: "Healthy", icon: "PA" }
];

const views = {
  dashboard: renderDashboard,
  investigations: renderInvestigations,
  cases: renderCases,
  hunt: renderHunt,
  detect: renderDetect,
  connectors: renderConnectors
};

const content = document.querySelector("#content");
const sidebar = document.querySelector("#sidebar");
const modal = document.querySelector("#modalBackdrop");

function pageHead(eyebrow, title, description, actions = "") {
  return `<div class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${description}</p></div><div class="head-actions">${actions}</div></div>`;
}

function renderDashboard() {
  const chart = [
    [77, 59, "18"], [58, 45, "19"], [81, 67, "20"], [64, 51, "21"], [91, 76, "22"], [70, 62, "23"], [83, 72, "24"]
  ].map(([created, resolved, day]) => `<div class="bar-pair"><i class="bar" style="height:${created}%"></i><i class="bar resolved" style="height:${resolved}%"></i><small>${day}</small></div>`).join("");
  content.innerHTML = pageHead("Respond / Command center", "Security, at machine speed.", "A live operational view across investigations, cases, and automated response.", `<button class="button" data-toast="Dashboard data refreshed">↻ Refresh</button><button class="button primary" data-view="investigations">View investigations</button>`) + `
    <section class="metrics">
      ${metric("Alerts processed", "28,492", "+12.8%", "in the last 24 hours")}
      ${metric("Noise suppressed", "96.4%", "+1.2%", "automatically resolved")}
      ${metric("Active investigations", "12", "3 critical", "requiring attention", true)}
      ${metric("Mean time to contain", "6m 42s", "−2m 18s", "vs. previous week")}
    </section>
    <section class="dashboard-grid">
      <article class="panel">
        <div class="panel-head"><div><h2 class="panel-title">Alert operations</h2><div class="panel-kicker">Created vs. autonomously resolved</div></div><select class="panel-select" aria-label="Chart range"><option>Last 7 days</option><option>Last 30 days</option></select></div>
        <div class="chart-wrap"><div class="chart">${chart}</div><div class="chart-legend"><span><i></i>Alerts created</span><span><i></i>Resolved by AISOC</span></div></div>
      </article>
      <article class="panel">
        <div class="panel-head"><div><h2 class="panel-title">Exposure radar</h2><div class="panel-kicker">Risk concentration by entity</div></div><span class="severity critical">3 critical</span></div>
        <div class="risk-orbit"><div class="crosshair"></div><i class="risk-node red" style="left:28%;top:19%"></i><i class="risk-node" style="right:16%;top:46%"></i><i class="risk-node mint" style="left:23%;bottom:19%"></i><div class="orbit-label"><div><strong>71</strong><small>Risk index</small></div></div></div>
      </article>
      ${incidentTable(incidents.slice(0, 5), true)}
    </section>`;
}

function metric(label, value, delta, foot, warning = false) {
  return `<article class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-foot"><span class="delta ${warning ? "warn" : ""}">${delta}</span><span>${foot}</span></div></article>`;
}

function incidentTable(rows, dashboard = false) {
  return `<article class="panel feed"><div class="panel-head"><div><h2 class="panel-title">${dashboard ? "Priority investigations" : "Investigation queue"}</h2><div class="panel-kicker">Mock telemetry sorted by risk score</div></div>${dashboard ? `<button class="button" data-view="investigations">View all</button>` : ""}</div><div class="table-wrap"><table><thead><tr><th>Investigation</th><th>Severity</th><th>Source</th><th>Status</th><th>Owner</th><th>Age</th></tr></thead><tbody>${rows.map(row => `<tr data-incident="${row.id}"><td><span class="incident-title">${row.title}</span><br><span class="incident-id">${row.id} · Score ${row.score}</span></td><td><span class="severity ${row.severity}">${row.severity}</span></td><td>${row.source}</td><td><span class="status ${row.status.toLowerCase()}">${row.status}</span></td><td>${row.owner}</td><td>${row.age}</td></tr>`).join("")}</tbody></table></div></article>`;
}

function renderInvestigations() {
  content.innerHTML = pageHead("Respond", "Investigations", "Agent-led investigations correlated across identity, endpoint, cloud, email, and network sources.", `<button class="button" data-toast="CSV export generated locally">Export</button><button class="button primary" data-toast="Mock investigation created">New investigation</button>`) + `
    <div class="toolbar"><input class="filter-input" id="incidentFilter" placeholder="Filter by title, ID, source, entity..."><select class="panel-select" id="severityFilter"><option value="all">All severity</option><option>critical</option><option>high</option><option>medium</option><option>low</option></select></div>
    <div class="summary-strip"><span><strong>${incidents.length}</strong> total</span><span><strong>3</strong> automated</span><span><strong>2</strong> awaiting review</span><span><strong>94</strong> highest risk</span></div>
    <div id="incidentTable">${incidentTable(incidents)}</div>`;
  bindIncidentFilters();
}

function renderCases() {
  const cases = [
    ["CASE-219", "OAuth token compromise", "Critical", "In progress", "34m"],
    ["CASE-214", "Finance endpoint malware", "High", "Evidence review", "2h"],
    ["CASE-209", "Cloud data access anomaly", "High", "Contained", "5h"],
    ["CASE-202", "Identity policy drift", "Medium", "Monitoring", "1d"],
    ["CASE-198", "Phishing infrastructure cluster", "Medium", "Closed", "2d"]
  ];
  content.innerHTML = pageHead("Respond", "Case management", "Track evidence, tasks, ownership, and service-level objectives from triage through closure.", `<button class="button primary" data-toast="Mock case created">Create case</button>`) + `<section class="cards-grid">${cases.map((item, index) => `<article class="entity-card" data-toast="Opened ${item[0]}"><div class="entity-top"><span class="severity ${item[2].toLowerCase()}">${item[2]}</span><span class="incident-id">${item[0]}</span></div><h3>${item[1]}</h3><p>${item[3]} · Updated ${item[4]} ago</p><div class="metric-foot"><span class="delta">${index + 2} tasks</span><span>${index + 4} evidence items</span></div></article>`).join("")}</section>`;
}

function renderHunt() {
  content.innerHTML = pageHead("Hunt", "Federated threat hunt", "Ask a question across connected data sources. This local replica returns deterministic mock findings.", `<button class="button" data-toast="Hunt history is mocked locally">History</button>`) + `
    <section class="hunt-console"><article class="panel query-box"><div class="panel-head"><div><h2 class="panel-title">New hunt</h2><div class="panel-kicker">Natural language or advanced query</div></div><span class="live-pill"><i></i> 6 sources ready</span></div><textarea id="huntQuery" aria-label="Threat hunt query">Find users who authenticated from two countries within 30 minutes and accessed sensitive cloud storage.</textarea><div class="head-actions" style="margin-top:10px"><button class="button primary" id="runHunt">Run hunt</button><button class="button" id="clearHunt">Clear</button></div></article><aside class="panel"><div class="panel-head"><div><h2 class="panel-title">Suggested hunts</h2><div class="panel-kicker">Based on current exposure</div></div></div><div class="suggestion-list"><button class="suggestion">Find dormant admin accounts used this week</button><button class="suggestion">Trace encoded PowerShell to parent process</button><button class="suggestion">Identify OAuth apps with mailbox access</button></div></aside></section><section class="panel" id="huntResults" style="margin-top:10px"><div class="empty-results"><strong>No hunt running</strong>Results will appear here without contacting any API.</div></section>`;
  bindHunt();
}

function renderDetect() {
  const detections = [
    ["Impossible travel + token reuse", "Identity", "High", "92%", "1.4K"],
    ["Suspicious OAuth consent", "Cloud", "Critical", "96%", "217"],
    ["Encoded script interpreter", "Endpoint", "High", "89%", "864"],
    ["Bulk object collection", "Cloud", "Medium", "81%", "302"],
    ["C2 beacon timing", "Network", "High", "87%", "94"],
    ["Inbox rule manipulation", "Email", "Medium", "79%", "531"]
  ];
  content.innerHTML = pageHead("Detect", "Detection engineering", "Measure rule coverage, tune fidelity, and identify gaps across your telemetry estate.", `<button class="button" data-toast="Coverage report downloaded">Coverage report</button><button class="button primary" data-toast="Mock rule draft created">Create rule</button>`) + `<section class="metrics">${metric("Active detections", "248", "+14", "this month")}${metric("MITRE coverage", "78%", "+4.6%", "across techniques")}${metric("True positive rate", "88.2%", "+2.1%", "validated findings")}${metric("Coverage gaps", "19", "5 priority", "recommended rules", true)}</section><section class="cards-grid">${detections.map(d => `<article class="entity-card" data-toast="Opened detection: ${d[0]}"><div class="entity-top"><span class="severity ${d[2].toLowerCase()}">${d[2]}</span><span class="incident-id">${d[1]}</span></div><h3>${d[0]}</h3><p>${d[3]} confidence · ${d[4]} signals evaluated</p><div class="metric-foot"><span class="delta">Enabled</span><span>Autonomous triage</span></div></article>`).join("")}</section>`;
}

function renderConnectors() {
  content.innerHTML = pageHead("Tune", "Connectors", "Manage data sources used by investigation, detection, and response agents.", `<button class="button primary" data-toast="Connector catalog opened in mock mode">Add connector</button>`) + `<div class="summary-strip"><span><strong>6</strong> active</span><span><strong>49.1M</strong> events / day</span><span><strong>99.98%</strong> ingestion uptime</span></div><section class="cards-grid">${connectors.map(connector => `<article class="entity-card" data-toast="${connector.name} configuration opened"><div class="entity-top"><span class="entity-icon">${connector.icon}</span><span class="health ${connector.health === "Healthy" ? "" : "warn"}">● ${connector.health}</span></div><h3>${connector.name}</h3><p>${connector.type}</p><div class="metric-foot"><span>${connector.events} events / 24h</span><span>↗</span></div></article>`).join("")}</section>`;
}

function navigate(view) {
  const selected = views[view] ? view : "dashboard";
  document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.view === selected));
  views[selected]();
  bindDynamicEvents();
  sidebar.classList.remove("open");
  if (location.hash !== `#${selected}`) history.pushState(null, "", `#${selected}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindDynamicEvents() {
  document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", event => { event.preventDefault(); navigate(button.dataset.view); }));
  document.querySelectorAll("[data-toast]").forEach(button => button.addEventListener("click", () => showToast(button.dataset.toast)));
  document.querySelectorAll("[data-incident]").forEach(row => row.addEventListener("click", () => openIncident(row.dataset.incident)));
}

function bindIncidentFilters() {
  const input = document.querySelector("#incidentFilter");
  const severity = document.querySelector("#severityFilter");
  const update = () => {
    const query = input.value.toLowerCase();
    const filtered = incidents.filter(item => (severity.value === "all" || item.severity === severity.value) && Object.values(item).join(" ").toLowerCase().includes(query));
    document.querySelector("#incidentTable").innerHTML = incidentTable(filtered);
    bindDynamicEvents();
  };
  input.addEventListener("input", update);
  severity.addEventListener("change", update);
}

function bindHunt() {
  const query = document.querySelector("#huntQuery");
  document.querySelectorAll(".suggestion").forEach(item => item.addEventListener("click", () => { query.value = item.textContent; }));
  document.querySelector("#clearHunt").addEventListener("click", () => { query.value = ""; });
  document.querySelector("#runHunt").addEventListener("click", () => {
    if (!query.value.trim()) return showToast("Enter a hunt query first");
    const results = document.querySelector("#huntResults");
    results.innerHTML = `<div class="panel-head"><div><h2 class="panel-title">Hunt complete</h2><div class="panel-kicker">Mock execution · 6 sources · 2.8 seconds</div></div><span class="severity high">3 findings</span></div>${incidentTable(incidents.slice(0, 3)).replace('class="panel feed"', 'class="feed"')}`;
    bindDynamicEvents();
    showToast("Hunt completed with 3 mock findings");
  });
}

function openIncident(id) {
  const item = incidents.find(incident => incident.id === id);
  if (!item) return;
  document.querySelector("#modalContent").innerHTML = `<p class="eyebrow">${item.id} · ${item.source}</p><h2 id="modalTitle">${item.title}</h2><p>AISOC correlated identity, endpoint, and cloud telemetry to assemble this mock investigation. No backend request was made.</p><div class="detail-grid"><div class="detail"><small>Risk score</small><strong>${item.score} / 100</strong></div><div class="detail"><small>Primary entity</small><strong>${item.entity}</strong></div><div class="detail"><small>Owner</small><strong>${item.owner}</strong></div><div class="detail"><small>Status</small><strong>${item.status}</strong></div></div><div class="timeline"><div class="timeline-item"><strong>Signal correlated</strong><small>Four alerts joined by identity and device · ${item.age} ago</small></div><div class="timeline-item"><strong>Agent investigation completed</strong><small>Authentication, process, and network evidence analyzed</small></div><div class="timeline-item"><strong>Recommended action ready</strong><small>Revoke sessions and isolate affected entity</small></div></div><div class="head-actions"><button class="button primary" data-modal-action="Containment simulated">Approve containment</button><button class="button" data-modal-action="Case created locally">Create case</button></div>`;
  modal.hidden = false;
  document.querySelectorAll("[data-modal-action]").forEach(button => button.addEventListener("click", () => { showToast(button.dataset.modalAction); closeModal(); }));
}

function closeModal() { modal.hidden = true; }
function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.querySelector("#toastStack").append(toast);
  setTimeout(() => toast.remove(), 2800);
}

document.querySelectorAll(".nav-item").forEach(item => item.addEventListener("click", event => { event.preventDefault(); navigate(item.dataset.view); }));
document.querySelector("#menuButton").addEventListener("click", () => sidebar.classList.toggle("open"));
document.querySelector("#modalClose").addEventListener("click", closeModal);
modal.addEventListener("click", event => { if (event.target === modal) closeModal(); });
document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeModal();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); document.querySelector("#globalSearch").focus(); }
});
document.querySelector("#globalSearch").addEventListener("keydown", event => { if (event.key === "Enter" && event.target.value.trim()) { navigate("investigations"); const filter = document.querySelector("#incidentFilter"); filter.value = event.target.value; filter.dispatchEvent(new Event("input")); } });
document.querySelector("#notificationButton").addEventListener("click", () => showToast("2 mock notifications: connector degradation and case review"));
document.querySelector("#helpButton").addEventListener("click", () => showToast("Local mock: all actions remain in this browser"));
document.querySelector("#profileButton").addEventListener("click", () => showToast("Authentication bypassed for local testing"));
window.addEventListener("hashchange", () => navigate(location.hash.slice(1)));

navigate(location.hash.slice(1) || "dashboard");
