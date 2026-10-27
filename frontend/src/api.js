const API_BASE = import.meta.env.VITE_API_URL || "/api/v1";
const TENANT_ID = import.meta.env.VITE_TENANT_ID || "demo";

class ApiClient {
  constructor(baseUrl = API_BASE, tenantId = TENANT_ID) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.tenantId = tenantId;
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-Id": this.tenantId,
        ...options.headers
      },
      body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
    });
    if (response.status === 204) return null;
    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(payload.error?.message || `API request failed (${response.status})`);
      error.code = payload.error?.code;
      error.details = payload.error?.details;
      throw error;
    }
    return payload;
  }

  list(resource, query = {}) {
    const search = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== ""));
    return this.request(`/${resource}${search.size ? `?${search}` : ""}`);
  }
  get(resource, id) { return this.request(`/${resource}/${encodeURIComponent(id)}`); }
  create(resource, body) { return this.request(`/${resource}`, { method: "POST", body }); }
  update(resource, id, body) { return this.request(`/${resource}/${encodeURIComponent(id)}`, { method: "PATCH", body }); }
  remove(resource, id) { return this.request(`/${resource}/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  action(resource, id, action, body) { return this.request(`/${resource}/${encodeURIComponent(id)}/${action}`, { method: "POST", ...(body ? { body } : {}) }); }

  dashboard() { return this.request("/dashboard"); }
  investigations(query) { return this.list("investigations", query); }
  investigation(id) { return this.get("investigations", id); }
  reinvestigate(id) { return this.action("investigations", id, "reinvestigate"); }
  setDetermination(id, determination) { return this.action("investigations", id, "determination", { determination }); }
  detectionRules(query) { return this.list("detection-rules", query); }
  toggleDetectionRule(id) { return this.action("detection-rules", id, "toggle"); }
  hunts(query) { return this.list("hunts", query); }
  runHunt(id) { return this.action("hunts", id, "run"); }
  connectors(query) { return this.list("connectors", query); }
  createConnector(body) { return this.create("connectors", body); }
  testConnector(id) { return this.action("connectors", id, "test"); }
  remediations(query) { return this.list("remediations", query); }
  executeRemediation(id) { return this.action("remediations", id, "execute"); }
}

export const api = new ApiClient();
export { ApiClient };
