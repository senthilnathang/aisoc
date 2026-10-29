import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { tenantFor } from "./auth.js";
import { ApiError } from "./errors.js";

const text = (maxLength: number) =>
  Type.String({ minLength: 1, maxLength, pattern: "\\S" });
const Step = Type.Object(
  {
    title: text(300),
    instructions: Type.String({ maxLength: 4000 }),
    approval_required: Type.Boolean(),
  },
  { additionalProperties: false },
);
const PlanBody = Type.Object(
  {
    kind: Type.Union([Type.Literal("workflow"), Type.Literal("runbook")]),
    title: text(200),
    description: Type.String({ maxLength: 4000 }),
    domain: text(100),
    trigger: text(500),
    steps: Type.Array(Step, { minItems: 1, maxItems: 50 }),
  },
  { additionalProperties: false },
);
type PlanInput = Static<typeof PlanBody>;
type Plan = PlanInput & {
  id: string;
  version: number;
  state: "active" | "archived";
  created_at: string;
  updated_at: string;
};
type Assignment = {
  id: string;
  investigation_id: string;
  plan_id: string;
  snapshot: Plan;
  version: number;
  steps: {
    completed: boolean;
    note: string;
    updated_by: string | null;
    updated_at: string | null;
  }[];
  created_at: string;
};
const Version = Type.Object(
  { expected_version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
const Params = Type.Object({ id: text(100) });
const AssignmentParams = Type.Object({
  id: text(100),
  assignmentId: text(100),
});
const conflict = () =>
  new ApiError(
    409,
    "VERSION_CONFLICT",
    "This record changed. Reload it before saving your changes.",
  );

export class ResponsePlans {
  constructor(private db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS response_plans (
        tenant_id TEXT NOT NULL, id TEXT NOT NULL, document_json TEXT NOT NULL,
        PRIMARY KEY (tenant_id, id)
      );
      CREATE TABLE IF NOT EXISTS response_plan_versions (
        tenant_id TEXT NOT NULL, plan_id TEXT NOT NULL, version INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, plan_id, version),
        FOREIGN KEY (tenant_id, plan_id) REFERENCES response_plans(tenant_id, id)
      );
      CREATE TABLE IF NOT EXISTS case_runbooks (
        tenant_id TEXT NOT NULL, id TEXT NOT NULL, investigation_id TEXT NOT NULL, plan_id TEXT NOT NULL,
        document_json TEXT NOT NULL, PRIMARY KEY (tenant_id, id), UNIQUE (tenant_id, investigation_id, plan_id),
        FOREIGN KEY (tenant_id, investigation_id) REFERENCES investigations(tenant_id, id) ON DELETE CASCADE,
        FOREIGN KEY (tenant_id, plan_id) REFERENCES response_plans(tenant_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_case_runbooks_case ON case_runbooks(tenant_id, investigation_id);
      CREATE TABLE IF NOT EXISTS case_runbook_events (
        tenant_id TEXT NOT NULL, assignment_id TEXT NOT NULL, version INTEGER NOT NULL,
        document_json TEXT NOT NULL, PRIMARY KEY (tenant_id, assignment_id, version),
        FOREIGN KEY (tenant_id, assignment_id) REFERENCES case_runbooks(tenant_id, id) ON DELETE CASCADE
      );
    `);
    // Seed once, without restoring templates that operators subsequently archive or edit.
    if (
      !db
        .prepare("SELECT version FROM schema_migrations WHERE version = 12")
        .get()
    )
      this.transaction(() => {
        const templates: [string, string, string, string[]][] = [
          [
            "Identity",
            "Identity compromise",
            "Malicious identity verdict",
            [
              "Validate sign-in and device context",
              "Revoke active sessions",
              "Recover credentials and review OAuth grants",
              "Document user confirmation",
            ],
          ],
          [
            "Endpoint",
            "Endpoint malware",
            "Confirmed malware verdict",
            [
              "Confirm file hash and process tree",
              "Isolate affected device",
              "Preserve evidence and quarantine malicious files",
              "Verify cleanup before reconnecting",
            ],
          ],
          [
            "Email",
            "Malicious email",
            "Confirmed phishing verdict",
            [
              "Identify messages and recipients",
              "Quarantine matching messages",
              "Block sender and URLs",
              "Notify users and verify removal",
            ],
          ],
        ];
        for (const kind of ["workflow", "runbook"] as const)
          for (const [domain, title, trigger, steps] of templates)
            this.create(
              "demo",
              {
                kind,
                title:
                  kind === "workflow"
                    ? "Contain " + title.toLowerCase()
                    : title,
                domain,
                trigger:
                  kind === "workflow" ? trigger : domain + " response team",
                description:
                  "Review the evidence, contain the threat, and verify recovery.",
                steps: steps.map((title, i) => ({
                  title,
                  instructions:
                    i === 0
                      ? "Confirm the affected scope and investigation evidence."
                      : "Record the outcome and supporting evidence on the case.",
                  approval_required: i === 1,
                })),
              },
              "system-template",
              false,
            );
        db.prepare(
          "INSERT INTO schema_migrations VALUES (12, datetime('now'))",
        ).run();
      });
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  list(tenant: string) {
    return this.db
      .prepare(
        "SELECT document_json FROM response_plans WHERE tenant_id = ? ORDER BY rowid DESC",
      )
      .all(tenant)
      .map((row) => JSON.parse(String(row.document_json)) as Plan);
  }
  get(tenant: string, id: string): Plan {
    const row = this.db
      .prepare(
        "SELECT document_json FROM response_plans WHERE tenant_id = ? AND id = ?",
      )
      .get(tenant, id);
    if (!row) throw new ApiError(404, "NOT_FOUND", "Response plan not found");
    return JSON.parse(String(row.document_json));
  }
  private save(tenant: string, plan: Plan, action: string, actor: string) {
    this.db
      .prepare(
        "INSERT INTO response_plans VALUES (?, ?, ?) ON CONFLICT(tenant_id,id) DO UPDATE SET document_json=excluded.document_json",
      )
      .run(tenant, plan.id, JSON.stringify(plan));
    this.db
      .prepare(
        "INSERT INTO response_plan_versions VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        tenant,
        plan.id,
        plan.version,
        JSON.stringify(plan),
        action,
        actor,
        plan.updated_at,
      );
    return plan;
  }
  create(
    tenant: string,
    input: PlanInput,
    actor: string,
    transactional = true,
  ): Plan {
    const now = new Date().toISOString();
    const create = () =>
      this.save(
        tenant,
        {
          ...input,
          id: randomUUID(),
          version: 1,
          state: "active",
          created_at: now,
          updated_at: now,
        },
        "created",
        actor,
      );
    return transactional ? this.transaction(create) : create();
  }
  update(
    tenant: string,
    id: string,
    input: PlanInput & { expected_version: number },
    actor: string,
  ) {
    return this.transaction(() => {
      const current = this.get(tenant, id);
      if (current.version !== input.expected_version) throw conflict();
      if (current.state === "archived")
        throw new ApiError(
          409,
          "ARCHIVED",
          "Restore this plan before editing it.",
        );
      if (current.kind !== input.kind)
        throw new ApiError(
          400,
          "INVALID_KIND",
          "A plan's kind cannot be changed.",
        );
      const { expected_version, ...fields } = input;
      return this.save(
        tenant,
        {
          ...current,
          ...fields,
          version: current.version + 1,
          updated_at: new Date().toISOString(),
        },
        "updated",
        actor,
      );
    });
  }
  state(
    tenant: string,
    id: string,
    version: number,
    state: Plan["state"],
    actor: string,
  ) {
    return this.transaction(() => {
      const current = this.get(tenant, id);
      if (current.version !== version) throw conflict();
      return this.save(
        tenant,
        {
          ...current,
          state,
          version: current.version + 1,
          updated_at: new Date().toISOString(),
        },
        state === "active" ? "restored" : "archived",
        actor,
      );
    });
  }
  duplicate(tenant: string, id: string, actor: string) {
    const plan = this.get(tenant, id);
    return this.create(
      tenant,
      {
        kind: plan.kind,
        title: plan.title.slice(0, 193) + " (copy)",
        description: plan.description,
        domain: plan.domain,
        trigger: plan.trigger,
        steps: plan.steps,
      },
      actor,
    );
  }
  history(tenant: string, id: string) {
    this.get(tenant, id);
    return this.db
      .prepare(
        "SELECT version, snapshot_json, action, actor, created_at FROM response_plan_versions WHERE tenant_id=? AND plan_id=? ORDER BY version DESC",
      )
      .all(tenant, id)
      .map(({ snapshot_json, ...row }) => ({
        ...row,
        snapshot: JSON.parse(String(snapshot_json)),
      }));
  }
  private caseExists(tenant: string, id: string) {
    if (
      !this.db
        .prepare("SELECT id FROM investigations WHERE tenant_id=? AND id=?")
        .get(tenant, id)
    )
      throw new ApiError(404, "NOT_FOUND", "Investigation not found");
  }
  assignments(tenant: string, caseId: string) {
    this.caseExists(tenant, caseId);
    return this.db
      .prepare(
        "SELECT document_json FROM case_runbooks WHERE tenant_id=? AND investigation_id=? ORDER BY rowid DESC",
      )
      .all(tenant, caseId)
      .map((row) => {
        const assignment = JSON.parse(String(row.document_json)) as Assignment;
        const history = this.db
          .prepare(
            "SELECT document_json FROM case_runbook_events WHERE tenant_id=? AND assignment_id=? ORDER BY version DESC",
          )
          .all(tenant, assignment.id)
          .map((event) => JSON.parse(String(event.document_json)));
        return { ...assignment, history };
      });
  }
  private caseEvent(
    tenant: string,
    assignment: Assignment,
    actor: string,
    action: string,
    details: Record<string, unknown>,
  ) {
    const now = new Date().toISOString();
    this.db
      .prepare("INSERT INTO case_runbook_events VALUES (?, ?, ?, ?)")
      .run(
        tenant,
        assignment.id,
        assignment.version,
        JSON.stringify({
          action,
          actor,
          created_at: now,
          version: assignment.version,
          ...details,
        }),
      );
    this.db
      .prepare(
        "INSERT INTO audit_events VALUES (?, ?, 'investigations', ?, ?, ?, ?, ?)",
      )
      .run(
        randomUUID(),
        tenant,
        assignment.investigation_id,
        action,
        JSON.stringify({ record_id: assignment.id, actor, ...details }),
        now,
        now,
      );
  }
  attach(
    tenant: string,
    caseId: string,
    planId: string,
    version: number,
    actor: string,
  ) {
    return this.transaction(() => {
      this.caseExists(tenant, caseId);
      const plan = this.get(tenant, planId);
      if (plan.version !== version) throw conflict();
      if (plan.kind !== "runbook" || plan.state !== "active")
        throw new ApiError(400, "INVALID_RUNBOOK", "Choose an active runbook.");
      if (
        this.db
          .prepare(
            "SELECT id FROM case_runbooks WHERE tenant_id=? AND investigation_id=? AND plan_id=?",
          )
          .get(tenant, caseId, planId)
      )
        throw new ApiError(
          409,
          "ALREADY_ATTACHED",
          "This runbook is already attached to the case.",
        );
      const assignment: Assignment = {
        id: randomUUID(),
        investigation_id: caseId,
        plan_id: planId,
        snapshot: plan,
        version: 1,
        steps: plan.steps.map(() => ({
          completed: false,
          note: "",
          updated_by: null,
          updated_at: null,
        })),
        created_at: new Date().toISOString(),
      };
      this.db
        .prepare("INSERT INTO case_runbooks VALUES (?, ?, ?, ?, ?)")
        .run(tenant, assignment.id, caseId, planId, JSON.stringify(assignment));
      this.caseEvent(tenant, assignment, actor, "runbook_attached", {
        title: plan.title,
        plan_version: plan.version,
      });
      return assignment;
    });
  }
  step(
    tenant: string,
    caseId: string,
    id: string,
    input: {
      expected_version: number;
      step_index: number;
      completed: boolean;
      note: string;
      approval_confirmed: boolean;
    },
    actor: string,
  ) {
    return this.transaction(() => {
      this.caseExists(tenant, caseId);
      const row = this.db
        .prepare(
          "SELECT document_json FROM case_runbooks WHERE tenant_id=? AND investigation_id=? AND id=?",
        )
        .get(tenant, caseId, id);
      if (!row)
        throw new ApiError(404, "NOT_FOUND", "Attached runbook not found");
      const assignment = JSON.parse(String(row.document_json)) as Assignment;
      if (assignment.version !== input.expected_version) throw conflict();
      const step = assignment.snapshot.steps[input.step_index];
      if (!step)
        throw new ApiError(400, "INVALID_STEP", "Runbook step not found");
      if (
        input.completed &&
        step.approval_required &&
        !input.approval_confirmed
      )
        throw new ApiError(
          400,
          "APPROVAL_REQUIRED",
          "Confirm analyst approval for this step.",
        );
      assignment.steps[input.step_index] = {
        completed: input.completed,
        note: input.note,
        updated_by: actor,
        updated_at: new Date().toISOString(),
      };
      assignment.version++;
      this.db
        .prepare(
          "UPDATE case_runbooks SET document_json=? WHERE tenant_id=? AND id=?",
        )
        .run(JSON.stringify(assignment), tenant, id);
      this.caseEvent(
        tenant,
        assignment,
        actor,
        input.completed ? "runbook_step_completed" : "runbook_step_updated",
        {
          step_index: input.step_index,
          title: step.title,
          note: input.note,
          approval_confirmed:
            input.completed &&
            step.approval_required &&
            input.approval_confirmed,
        },
      );
      return assignment;
    });
  }
}
export function registerResponseRoutes(
  app: FastifyInstance,
  plans: ResponsePlans,
  fallback: string,
) {
  const tenant = (r: FastifyRequest) => tenantFor(r, fallback);
  const actor = (r: FastifyRequest) => r.principal?.id || "local-development";
  app.get("/api/v1/response-plans", async (r) => ({
    items: plans.list(tenant(r)),
  }));
  app.post(
    "/api/v1/response-plans",
    { schema: { body: PlanBody } },
    async (r, reply) =>
      reply
        .code(201)
        .send(plans.create(tenant(r), r.body as PlanInput, actor(r))),
  );
  app.get<{ Params: { id: string } }>(
    "/api/v1/response-plans/:id",
    { schema: { params: Params } },
    async (r) => plans.get(tenant(r), r.params.id),
  );
  app.get<{ Params: { id: string } }>(
    "/api/v1/response-plans/:id/history",
    { schema: { params: Params } },
    async (r) => ({ items: plans.history(tenant(r), r.params.id) }),
  );
  app.patch<{
    Params: { id: string };
    Body: PlanInput & { expected_version: number };
  }>(
    "/api/v1/response-plans/:id",
    {
      schema: {
        params: Params,
        body: Type.Object(
          { ...PlanBody.properties, ...Version.properties },
          { additionalProperties: false },
        ),
      },
    },
    async (r) => plans.update(tenant(r), r.params.id, r.body, actor(r)),
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/response-plans/:id/duplicate",
    { schema: { params: Params } },
    async (r, reply) =>
      reply.code(201).send(plans.duplicate(tenant(r), r.params.id, actor(r))),
  );
  app.post<{
    Params: { id: string };
    Body: { expected_version: number; state: Plan["state"] };
  }>(
    "/api/v1/response-plans/:id/state",
    {
      schema: {
        params: Params,
        body: Type.Object(
          {
            ...Version.properties,
            state: Type.Union([
              Type.Literal("active"),
              Type.Literal("archived"),
            ]),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (r) =>
      plans.state(
        tenant(r),
        r.params.id,
        r.body.expected_version,
        r.body.state,
        actor(r),
      ),
  );
  app.get<{ Params: { id: string } }>(
    "/api/v1/investigations/:id/runbooks",
    { schema: { params: Params } },
    async (r) => ({ items: plans.assignments(tenant(r), r.params.id) }),
  );
  app.post<{
    Params: { id: string };
    Body: { plan_id: string; expected_version: number };
  }>(
    "/api/v1/investigations/:id/runbooks",
    {
      schema: {
        params: Params,
        body: Type.Object(
          { plan_id: text(100), ...Version.properties },
          { additionalProperties: false },
        ),
      },
    },
    async (r, reply) =>
      reply
        .code(201)
        .send(
          plans.attach(
            tenant(r),
            r.params.id,
            r.body.plan_id,
            r.body.expected_version,
            actor(r),
          ),
        ),
  );
  app.patch<{
    Params: { id: string; assignmentId: string };
    Body: {
      expected_version: number;
      step_index: number;
      completed: boolean;
      note: string;
      approval_confirmed: boolean;
    };
  }>(
    "/api/v1/investigations/:id/runbooks/:assignmentId",
    {
      schema: {
        params: AssignmentParams,
        body: Type.Object(
          {
            ...Version.properties,
            step_index: Type.Integer({ minimum: 0, maximum: 49 }),
            completed: Type.Boolean(),
            note: Type.String({ maxLength: 4000 }),
            approval_confirmed: Type.Boolean(),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (r) =>
      plans.step(
        tenant(r),
        r.params.id,
        r.params.assignmentId,
        r.body,
        actor(r),
      ),
  );
}
