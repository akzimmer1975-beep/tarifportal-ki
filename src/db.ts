import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL ist nicht gesetzt.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.PGSSLMODE === "disable"
      ? false
      : {
          rejectUnauthorized: false
        }
});

export async function testDbConnection() {
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT NOW() AS now");
    return result.rows[0];
  } finally {
    client.release();
  }
}