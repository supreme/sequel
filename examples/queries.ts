import { sql } from './db';

export async function findUsers(email: string, term: string) {
  const rows = await sql`
    SELECT id, name, created_at
    FROM users                       -- only active ones
    WHERE email = ${email}
      AND name ILIKE '%${term}%'
    ORDER BY created_at DESC
    LIMIT 10
  `;

  const count = await db.query("SELECT count(*) FROM users WHERE org_id = $1", [orgId]);
  await db.query('DELETE FROM sessions WHERE user_id = $1', [id]);

  const report = `
    WITH recent AS (
      SELECT * FROM orders WHERE placed_at > now() - interval '7 days'
    )
    SELECT ${columns.join(', ')} FROM recent
  `;

  // These stay plain strings:
  const message = "Update failed, select a different file";
  const method = "DELETE";
  const greeting = `
    Hello ${name}
  `;
  return { rows, count, report, message, method, greeting };
}
