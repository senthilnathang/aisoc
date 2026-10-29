CREATE TABLE skill_applications (
 tenant_id text NOT NULL, id text NOT NULL, skill_id text NOT NULL,
 target_type text NOT NULL CHECK(target_type IN ('investigation','hunt')),
 target_id text NOT NULL, skill_version integer NOT NULL,
 document jsonb NOT NULL, ordinal bigint GENERATED ALWAYS AS IDENTITY,
 PRIMARY KEY(tenant_id,id),
 UNIQUE(tenant_id,skill_id,target_type,target_id,skill_version),
 FOREIGN KEY(tenant_id,skill_id) REFERENCES skills(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX skill_applications_target ON skill_applications(tenant_id,target_type,target_id,ordinal DESC);
CREATE TABLE skill_application_feedback (
 tenant_id text NOT NULL,id text NOT NULL,application_id text NOT NULL,created_by text NOT NULL,
 document jsonb NOT NULL,ordinal bigint GENERATED ALWAYS AS IDENTITY,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,application_id,created_by),
 FOREIGN KEY(tenant_id,application_id) REFERENCES skill_applications(tenant_id,id) ON DELETE CASCADE
);
