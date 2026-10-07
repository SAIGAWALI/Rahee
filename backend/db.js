// MySQL-compatible database connection. Works unmodified against MySQL,
// MariaDB, or TiDB — TiDB speaks the MySQL wire protocol, which is the
// entire reason this file (and rooms.js, which is the only other file that
// talks to it) doesn't need to know which one it's actually pointed at.
//
// Configuration is env-var only (see .env.example) so the same code runs
// against a local MySQL for development and a managed TiDB cluster in
// production without an edit.
import mysql from "mysql2/promise";
import "dotenv/config";

const {
  DB_HOST = "127.0.0.1",
  DB_PORT = "4000", // TiDB's default MySQL-protocol port; MySQL itself defaults to 3306
  DB_USER = "root",
  DB_PASSWORD = "",
  DB_NAME = "rahee",
  DB_SSL, // "true" for TiDB Cloud and most other managed hosts, which require TLS
} = process.env;

export const pool = mysql.createPool({
  host: DB_HOST,
  port: Number(DB_PORT),
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  ssl: DB_SSL === "true" ? { minVersion: "TLSv1.2" } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
});

/**
 * Creates the one table this app needs, if it isn't there already. The
 * schema is small enough that a hand-rolled `CREATE TABLE IF NOT EXISTS`
 * beats bringing in a migration framework — schema.sql holds the same
 * statement for anyone setting the database up by hand instead.
 */
export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      code VARCHAR(4) PRIMARY KEY,
      seats JSON NOT NULL,
      state JSON NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}
