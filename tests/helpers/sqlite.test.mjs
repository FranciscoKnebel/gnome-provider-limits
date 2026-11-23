import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { assert } from "./node-harness.mjs";

test("SQLite syscall boundary reads complete WAL without touching files; incomplete/recovery fails safely", () => {
  const script = readFileSync("src/helpers/sqlite.ts", "utf8")
    .split("String.raw`")[1]
    .split("`;")[0];
  const dir = mkdtempSync(join(tmpdir(), "provider-limits-sqlite-"));
  try {
    const helper = join(dir, "read.py");
    writeFileSync(helper, script);
    const result = spawnSync(
      "python3",
      [
        "-c",
        `
import hashlib, json, os, pathlib, sqlite3, subprocess, sys
root, helper = pathlib.Path(sys.argv[1]), sys.argv[2]
def snapshot(db):
    return {str(p): (p.stat().st_mtime_ns, hashlib.sha256(p.read_bytes()).hexdigest())
            for p in root.glob(db.name+'*')}
def run(db, query='select * from t'):
    before = snapshot(db)
    r = subprocess.run([sys.executable,helper,str(db),query], capture_output=True, text=True)
    assert snapshot(db) == before, (db.name, r.stderr)
    return r
for state in ['plain','complete','closed-wal','wal-only','shm-only','journal']:
    db=root/state
    if state == 'journal':
        creator = "import os,sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('create table t(v)'); c.commit(); c.execute('pragma cache_size=1'); c.execute('begin immediate'); c.executemany('insert into t values(?)', [(str(i)*100,) for i in range(1000)]); os._exit(0)"
        subprocess.check_call([sys.executable,'-c',creator,str(db)])
    else:
        c=sqlite3.connect(db)
        if state != 'plain': c.execute('pragma journal_mode=wal')
        c.execute('create table t(v)'); c.execute('insert into t values(1)'); c.commit()
        if state == 'wal-only': os.unlink(str(db)+'-shm')
        if state == 'shm-only': os.unlink(str(db)+'-wal')
        if state == 'closed-wal': c.close()
    r=run(db)
    if state in ('plain','complete','closed-wal'): assert r.returncode == 0, r.stderr
    if state == 'closed-wal': assert json.loads(r.stdout) == [{'v': 1}], r.stdout
    if state in ('wal-only','shm-only','journal'): assert r.returncode != 0, (state,r.stdout)
    assert run(db, 'create table forbidden(v)').returncode != 0
    if state not in ('journal','closed-wal'): c.close()
# Sidecar cleanup at different points during open/read must never be undone.
for i, delay in enumerate([0, 0.005, 0.02, 0.04, 0.08]):
    db = root / ('race-' + str(i))
    c = sqlite3.connect(db); c.execute('pragma journal_mode=wal')
    c.execute('create table t(v)'); c.execute('insert into t values(1)'); c.commit()
    before = snapshot(db)
    cleanup = subprocess.Popen([sys.executable, '-c',
        'import os,sys,time; time.sleep(float(sys.argv[2])); os.unlink(sys.argv[1])',
        str(db)+'-shm', str(delay)])
    subprocess.run([sys.executable, helper, str(db), 'select * from t'], capture_output=True)
    assert cleanup.wait() == 0
    assert not pathlib.Path(str(db)+'-shm').exists(), 'reader recreated shared memory'
    after = snapshot(db)
    for path, state in after.items(): assert before[path] == state, path
    c.close()
# A missing path may race with the caller's existence check; it must not be created.
r=run(root/'missing'); assert r.returncode != 0
`,
        dir,
        helper,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
