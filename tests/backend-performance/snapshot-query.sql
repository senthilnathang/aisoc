-- Run in a dedicated local psql connection: psql -X -v ON_ERROR_STOP=1 -f tests/backend-performance/snapshot-query.sql
-- Uses only connection-local synthetic temporary tables; disconnect drops them.
-- No application data is read or written. This compares query CPU/plan cost, not pipeline EPS.
-- Fixture: 60k accepted, 40k completed, 5k dead without completion, 15k pending.
SET statement_timeout='15s'; SET work_mem='32MB';
CREATE TEMP TABLE stream_events AS SELECT 'probe'::text tenant_id,'probe'::text connector_id,'probe'::text source,md5(i::text)||md5(('key-'||i)::text) event_key,now()-interval '1 minute' created_at FROM generate_series(1,60000) i;
CREATE TEMP TABLE stream_inbox AS SELECT tenant_id,connector_id,source,'probe'::text processor,event_key FROM stream_events LIMIT 40000;
CREATE TEMP TABLE stream_consumer_work AS SELECT tenant_id,connector_id,source,'probe'::text processor,'event:'||event_key work_key,'dead'::text state FROM stream_events OFFSET 30000 LIMIT 15000;
CREATE TEMP TABLE stream_outbox AS SELECT tenant_id,connector_id,source,'published'::text state FROM stream_events;
CREATE TEMP TABLE stream_replay_gaps(tenant_id text,connector_id text,source text,processor text);
CREATE TEMP TABLE stream_dead_letters(LIKE stream_replay_gaps);
CREATE TEMP TABLE stream_event_archives(tenant_id text,connector_id text,source text);
ANALYZE stream_events; ANALYZE stream_inbox; ANALYZE stream_consumer_work; ANALYZE stream_outbox;

PREPARE snapshot_original AS WITH states AS MATERIALIZED ( SELECT event_key,min(created_at) AS created_at,bool_or(completed) AS completed,bool_or(dead) AS dead FROM ( SELECT event_key,created_at,false AS completed,false AS dead,true AS accepted FROM stream_events WHERE tenant_id='probe' AND connector_id='probe' AND source='probe' UNION ALL SELECT event_key,NULL,true,false,false FROM stream_inbox WHERE tenant_id='probe' AND connector_id='probe' AND source='probe' AND processor='probe' UNION ALL SELECT substring(work_key from 7),NULL,false,true,false FROM stream_consumer_work WHERE tenant_id='probe' AND connector_id='probe' AND source='probe' AND processor='probe' AND state='dead' AND work_key LIKE 'event:%' ) records GROUP BY event_key HAVING bool_or(accepted)) SELECT count(*),count(*) FILTER(WHERE completed),count(*) FILTER(WHERE NOT completed AND dead),count(*) FILTER(WHERE NOT completed AND NOT dead), COALESCE(GREATEST(0,extract(epoch FROM clock_timestamp()-min(created_at) FILTER(WHERE NOT completed AND NOT dead))),0), (SELECT count(*) FROM stream_outbox WHERE tenant_id='probe' AND connector_id='probe' AND source='probe' AND state='failed'), (SELECT count(*) FROM stream_replay_gaps WHERE tenant_id='probe' AND connector_id='probe' AND source='probe' AND processor='probe'), (SELECT count(*) FROM stream_dead_letters WHERE tenant_id='probe' AND connector_id='probe' AND source='probe' AND processor='probe'), (SELECT count(*) FROM stream_event_archives WHERE tenant_id='probe' AND connector_id='probe' AND source='probe') FROM states;
PREPARE snapshot_flags AS WITH states AS MATERIALIZED (
 SELECT event_key,min(created_at) AS created_at,bit_or(flags) AS flags FROM (
 SELECT event_key,created_at,1 AS flags FROM stream_events WHERE tenant_id='probe' AND connector_id='probe' AND source='probe'
 UNION ALL SELECT event_key,NULL,2 FROM stream_inbox WHERE tenant_id='probe' AND connector_id='probe' AND source='probe' AND processor='probe'
 UNION ALL SELECT substring(work_key from 7),NULL,4 FROM stream_consumer_work WHERE tenant_id='probe' AND connector_id='probe' AND source='probe' AND processor='probe' AND state='dead' AND work_key LIKE 'event:%'
 ) records GROUP BY event_key HAVING (bit_or(flags)&1)=1)
 SELECT count(*),count(*) FILTER(WHERE (flags&2)=2),count(*) FILTER(WHERE (flags&6)=4),count(*) FILTER(WHERE (flags&6)=0),
 COALESCE(GREATEST(0,extract(epoch FROM clock_timestamp()-min(created_at) FILTER(WHERE (flags&6)=0))),0),
 (SELECT count(*) FROM stream_outbox WHERE tenant_id='probe' AND connector_id='probe' AND source='probe' AND state='failed'),
 (SELECT count(*) FROM stream_replay_gaps WHERE tenant_id='probe' AND connector_id='probe' AND source='probe' AND processor='probe'),
 (SELECT count(*) FROM stream_dead_letters WHERE tenant_id='probe' AND connector_id='probe' AND source='probe' AND processor='probe'),
 (SELECT count(*) FROM stream_event_archives WHERE tenant_id='probe' AND connector_id='probe' AND source='probe')
 FROM states;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE snapshot_original;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE snapshot_flags;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE snapshot_flags;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE snapshot_original;
EXECUTE snapshot_original;
EXECUTE snapshot_flags;
