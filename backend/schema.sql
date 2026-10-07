-- RAHEE backend schema — works unmodified on MySQL, MariaDB, or TiDB.
-- The server also creates this table itself on boot (see db.js's migrate()),
-- so running this by hand is only needed if you'd rather set the database
-- up yourself ahead of time (e.g. via the TiDB Cloud SQL console).

CREATE DATABASE IF NOT EXISTS rahee;
USE rahee;

CREATE TABLE IF NOT EXISTS rooms (
  code VARCHAR(4) PRIMARY KEY,   -- the 4-letter room code players share
  seats JSON NOT NULL,           -- [{ name, characterId }, ...] — never a live socket, see rooms.js
  state JSON NULL,               -- the full engine.js game state once started, minus board.json (reattached on load)
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
