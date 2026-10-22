import { DataSource } from 'typeorm';

const CDC_SQL = [
    `CREATE OR REPLACE FUNCTION pms_capture_task_changes() RETURNS trigger AS $$
     BEGIN
         IF (TG_OP = 'INSERT') THEN
             INSERT INTO task_changes (op, task_id, old_row, new_row) VALUES ('I', NEW.task_id, NULL, to_jsonb(NEW));
         ELSIF (TG_OP = 'UPDATE') THEN
             IF to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
                 INSERT INTO task_changes (op, task_id, old_row, new_row) VALUES ('U', NEW.task_id, to_jsonb(OLD), to_jsonb(NEW));
             END IF;
         ELSE
             INSERT INTO task_changes (op, task_id, old_row, new_row) VALUES ('D', OLD.task_id, to_jsonb(OLD), NULL);
         END IF;
         RETURN NULL;
     END;
     $$ LANGUAGE plpgsql`,
    `DROP TRIGGER IF EXISTS trg_tasks_cdc ON tasks`,
    `CREATE TRIGGER trg_tasks_cdc AFTER INSERT OR UPDATE OR DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION pms_capture_task_changes()`,
    `CREATE OR REPLACE FUNCTION pms_forbid_log_changes() RETURNS trigger AS $$
     BEGIN
         RAISE EXCEPTION 'task_changes es un log de solo-añadir: no se permite % ', TG_OP;
     END;
     $$ LANGUAGE plpgsql`,
    `DROP TRIGGER IF EXISTS trg_task_changes_immutable ON task_changes`,
    `CREATE TRIGGER trg_task_changes_immutable BEFORE UPDATE OR DELETE ON task_changes FOR EACH ROW EXECUTE FUNCTION pms_forbid_log_changes()`,
    `INSERT INTO task_changes (op, task_id, old_row, new_row, changed_at)
     SELECT 'I', t.task_id, NULL, to_jsonb(t), COALESCE(t.created_at, now())
       FROM tasks t
      WHERE NOT EXISTS (SELECT 1 FROM task_changes c WHERE c.task_id = t.task_id)
      ORDER BY t.created_at`
];

const ADVISORY_LOCK_KEY = 7101;

export async function ensureCdc(dataSource: DataSource): Promise<void> {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    try {
        await runner.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
        for (const statement of CDC_SQL) {
            await runner.query(statement);
        }
    } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => undefined);
        await runner.release();
    }
}
