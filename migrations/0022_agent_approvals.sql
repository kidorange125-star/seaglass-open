-- The assistant asking before it acts (worker/approvals.ts). One row per question while the run waits for an answer.
-- Only the decision is kept, never what the action would have written.
CREATE TABLE agent_approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | denied | expired
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX agent_approvals_created ON agent_approvals(created_at);
