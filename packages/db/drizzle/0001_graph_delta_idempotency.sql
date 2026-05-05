CREATE TABLE IF NOT EXISTS graph_delta_commits (
  idempotency_key text PRIMARY KEY,
  request_hash text NOT NULL,
  profile_id text,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  response jsonb NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS graph_delta_commits_profile_idx ON graph_delta_commits(profile_id);
CREATE INDEX IF NOT EXISTS graph_delta_commits_created_at_idx ON graph_delta_commits(created_at);
CREATE INDEX IF NOT EXISTS graph_delta_commits_scope_tenant_idx ON graph_delta_commits((scope->>'tenant_id'));

CREATE INDEX IF NOT EXISTS graph_nodes_profile_idx ON graph_nodes((metadata->>'profile_id'));
CREATE INDEX IF NOT EXISTS graph_nodes_ontology_profile_idx ON graph_nodes((metadata->'ontology'->>'profile_id'));
CREATE INDEX IF NOT EXISTS graph_nodes_ontology_type_idx ON graph_nodes((metadata->'ontology'->>'type'));
CREATE INDEX IF NOT EXISTS graph_nodes_lifecycle_idx ON graph_nodes((metadata->>'lifecycle_status'));
CREATE INDEX IF NOT EXISTS graph_nodes_valid_to_idx ON graph_nodes((metadata->>'valid_to'));

CREATE INDEX IF NOT EXISTS graph_edges_profile_idx ON graph_edges((metadata->>'profile_id'));
CREATE INDEX IF NOT EXISTS graph_edges_synapse_type_idx ON graph_edges((metadata->>'synapse_type'));
CREATE INDEX IF NOT EXISTS graph_edges_pointer_key_idx ON graph_edges((metadata->'properties'->>'current_pointer_key'));
CREATE INDEX IF NOT EXISTS graph_edges_lifecycle_idx ON graph_edges((metadata->>'lifecycle_status'));
