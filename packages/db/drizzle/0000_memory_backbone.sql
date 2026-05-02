CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

DO $$ BEGIN
  CREATE TYPE source_system AS ENUM ('repo', 'doc', 'ticket', 'runtime', 'user');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE node_type AS ENUM (
    'Agent',
    'Session',
    'Run',
    'Task',
    'Decision',
    'Summary',
    'Template',
    'Repository',
    'CodeFile',
    'CodeSymbol',
    'Document',
    'DocSection',
    'Ticket',
    'PR',
    'Commit',
    'TestCase',
    'Error',
    'Artifact',
    'Person',
    'Policy'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE edge_type AS ENUM (
    'references',
    'derived_from',
    'implements',
    'depends_on',
    'related_to',
    'caused_by',
    'fixes',
    'mentions',
    'validated_by',
    'contradicts',
    'blocks',
    'handed_off_to',
    'used_template',
    'summarizes'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE run_status AS ENUM (
    'planned',
    'running',
    'waiting_tool',
    'waiting_human',
    'summarizing',
    'handoff_ready',
    'completed',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS graph_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type node_type NOT NULL,
  title text NOT NULL,
  content_ref text,
  summary text,
  source_system source_system,
  trust_score real NOT NULL DEFAULT 0.5 CHECK (trust_score >= 0 AND trust_score <= 1),
  freshness_score real NOT NULL DEFAULT 0.5 CHECK (freshness_score >= 0 AND freshness_score <= 1),
  importance_score real NOT NULL DEFAULT 0.5 CHECK (importance_score >= 0 AND importance_score <= 1),
  embedding vector(1536),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trace_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text NOT NULL,
  session_id text NOT NULL,
  objective text NOT NULL,
  status run_status NOT NULL DEFAULT 'planned',
  context_pack_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS graph_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_node_id uuid NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  to_node_id uuid NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  type edge_type NOT NULL,
  weight real NOT NULL DEFAULT 1 CHECK (weight >= 0),
  confidence real NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  source_run_id uuid REFERENCES trace_runs(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT graph_edges_unique_directed UNIQUE (from_node_id, to_node_id, type)
);

CREATE TABLE IF NOT EXISTS content_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  source_uri text NOT NULL,
  ordinal integer NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  embedding vector(1536),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_chunks_source_ordinal UNIQUE (source_uri, ordinal)
);

CREATE TABLE IF NOT EXISTS context_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective text NOT NULL,
  agent_id text NOT NULL,
  session_id text NOT NULL,
  node_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  template_id text,
  token_budget integer NOT NULL CHECK (token_budget > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE trace_runs
  ADD CONSTRAINT trace_runs_context_pack_fk
  FOREIGN KEY (context_pack_id)
  REFERENCES context_packs(id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS handoff_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_run_id uuid NOT NULL REFERENCES trace_runs(id) ON DELETE CASCADE,
  to_session_id text,
  objective text NOT NULL,
  current_status text NOT NULL,
  key_decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  referenced_node_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  open_loops jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_next_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trace_spans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES trace_runs(id) ON DELETE CASCADE,
  parent_span_id uuid,
  name text NOT NULL,
  kind text NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE INDEX IF NOT EXISTS graph_nodes_type_idx ON graph_nodes(type);
CREATE INDEX IF NOT EXISTS graph_nodes_source_idx ON graph_nodes(source_system);
CREATE INDEX IF NOT EXISTS graph_nodes_updated_at_idx ON graph_nodes(updated_at);
CREATE INDEX IF NOT EXISTS graph_nodes_embedding_hnsw_idx ON graph_nodes USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS graph_edges_from_idx ON graph_edges(from_node_id);
CREATE INDEX IF NOT EXISTS graph_edges_to_idx ON graph_edges(to_node_id);
CREATE INDEX IF NOT EXISTS graph_edges_type_idx ON graph_edges(type);
CREATE INDEX IF NOT EXISTS graph_edges_confidence_idx ON graph_edges(confidence);

CREATE INDEX IF NOT EXISTS content_chunks_node_idx ON content_chunks(node_id);
CREATE INDEX IF NOT EXISTS content_chunks_embedding_hnsw_idx ON content_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS context_packs_agent_idx ON context_packs(agent_id);
CREATE INDEX IF NOT EXISTS context_packs_session_idx ON context_packs(session_id);
CREATE INDEX IF NOT EXISTS context_packs_created_at_idx ON context_packs(created_at);

CREATE INDEX IF NOT EXISTS trace_runs_agent_idx ON trace_runs(agent_id);
CREATE INDEX IF NOT EXISTS trace_runs_session_idx ON trace_runs(session_id);
CREATE INDEX IF NOT EXISTS trace_runs_status_idx ON trace_runs(status);
CREATE INDEX IF NOT EXISTS trace_runs_created_at_idx ON trace_runs(created_at);

CREATE INDEX IF NOT EXISTS handoff_packs_from_run_idx ON handoff_packs(from_run_id);
CREATE INDEX IF NOT EXISTS handoff_packs_created_at_idx ON handoff_packs(created_at);

CREATE INDEX IF NOT EXISTS trace_spans_run_idx ON trace_spans(run_id);
CREATE INDEX IF NOT EXISTS trace_spans_parent_idx ON trace_spans(parent_span_id);
CREATE INDEX IF NOT EXISTS trace_spans_kind_idx ON trace_spans(kind);
CREATE INDEX IF NOT EXISTS trace_spans_started_at_idx ON trace_spans(started_at);

