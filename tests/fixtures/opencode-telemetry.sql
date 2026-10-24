CREATE TABLE session (id TEXT PRIMARY KEY, time_created INTEGER NOT NULL);
CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, data TEXT NOT NULL);
INSERT INTO session VALUES ('one', 1), ('two', 2), ('empty', 3);
INSERT INTO message VALUES
  ('a', 'one', '{"role":"assistant","cost":1.25}'),
  ('b', 'one', '{"role":"assistant","cost":2.5}'),
  ('c', 'two', '{"role":"assistant","cost":0}'),
  ('d', 'two', '{"role":"user","cost":999}'),
  ('e', 'two', '{"role":"assistant"}'),
  ('f', 'two', 'malformed'),
  ('g', 'two', '{"role":"assistant","cost":"999"}'),
  ('h', 'two', '{"role":"assistant","cost":-5}');
