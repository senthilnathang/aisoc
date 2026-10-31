CREATE TABLE detection_routing_configs (
 tenant_id text PRIMARY KEY REFERENCES tenants(id), version integer NOT NULL CHECK(version>0),
 document jsonb NOT NULL, updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE detection_routing_previews (
 tenant_id text NOT NULL REFERENCES tenants(id), id text NOT NULL, base_version integer NOT NULL,
 document jsonb NOT NULL, sample_hash text NOT NULL, window_end timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id)
);
CREATE INDEX detection_routing_previews_age ON detection_routing_previews(tenant_id,created_at);
