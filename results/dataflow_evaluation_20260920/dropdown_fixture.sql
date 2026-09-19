-- Isolated local UI fixture only. Never ingest into the hosted database.
INSERT INTO runs (key, run_id, tester_id, edge_id, mode, last_event_at) VALUES
('picker-a', 'selector-fixture', 'test-only-A', 'local-ui-fixture', 'simulation', '2026-09-20T00:00:00Z'),
('picker-b', 'selector-fixture', 'test-only-B', 'local-ui-fixture', 'replay', '2026-09-19T00:00:00Z');
