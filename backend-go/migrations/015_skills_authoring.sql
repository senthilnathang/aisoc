CREATE TABLE skills (
 tenant_id text NOT NULL REFERENCES tenants(id), id text NOT NULL,
 document jsonb NOT NULL, tags_search text NOT NULL DEFAULT '[]',
 updated_at timestamptz NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
 PRIMARY KEY(tenant_id,id)
);
CREATE INDEX skills_updated ON skills(tenant_id,updated_at DESC);
CREATE TABLE skill_materials (
 tenant_id text NOT NULL, skill_id text NOT NULL, id text NOT NULL,
 document jsonb NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,skill_id) REFERENCES skills(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX skill_materials_parent ON skill_materials(tenant_id,skill_id);
CREATE TABLE skill_material_versions (
 tenant_id text NOT NULL, material_id text NOT NULL, version integer NOT NULL,
 snapshot jsonb NOT NULL, created_by text NOT NULL, created_at text NOT NULL,
 PRIMARY KEY(tenant_id,material_id,version),
 FOREIGN KEY(tenant_id,material_id) REFERENCES skill_materials(tenant_id,id) ON DELETE CASCADE
);
