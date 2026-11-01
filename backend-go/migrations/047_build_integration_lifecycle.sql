ALTER TABLE local_integration_profiles DROP CONSTRAINT local_integration_profiles_state_check;
ALTER TABLE local_integration_profiles ADD CONSTRAINT local_integration_profiles_state_check CHECK(state IN ('draft','sealed','archived'));
ALTER TABLE local_integration_profiles ADD COLUMN cloned_from text NOT NULL DEFAULT '';
ALTER TABLE local_integration_profiles ADD COLUMN cloned_version integer NOT NULL DEFAULT 0;
ALTER TABLE local_integration_profiles ADD COLUMN clone_name text NOT NULL DEFAULT '';
CREATE TABLE local_integration_revisions (
 tenant_id text NOT NULL,
 profile_id text NOT NULL,
 version integer NOT NULL,
 name text NOT NULL,
 state text NOT NULL,
 document jsonb NOT NULL,
 actor text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,profile_id,version),
 FOREIGN KEY(tenant_id,profile_id) REFERENCES local_integration_profiles(tenant_id,id) ON DELETE CASCADE
);
-- Backfill only the snapshot actually available; do not invent earlier revisions.
INSERT INTO local_integration_revisions(tenant_id,profile_id,version,name,state,document,actor,recorded_at)
 SELECT tenant_id,id,version,name,state,document,actor,updated_at FROM local_integration_profiles;
CREATE FUNCTION record_local_integration_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO local_integration_revisions(tenant_id,profile_id,version,name,state,document,actor)
 VALUES(NEW.tenant_id,NEW.id,NEW.version,NEW.name,NEW.state,NEW.document,NEW.actor)
 ON CONFLICT(tenant_id,profile_id,version) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER local_integration_revision AFTER INSERT OR UPDATE ON local_integration_profiles
 FOR EACH ROW EXECUTE FUNCTION record_local_integration_revision();
