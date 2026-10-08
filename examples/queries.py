import sqlite3

BUILD_TABLE = """
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL  -- display name
  )
"""


def find(cur: sqlite3.Cursor, table: str, name: str):
    """Select people by name."""
    cur.execute("SELECT id, name FROM people WHERE name = %s", (name,))
    cur.execute(
        f"""
        UPDATE {table}
        SET seen = datetime('now')
        WHERE name LIKE '%{name}%'
        """
    )
    return cur.fetchall()


METHODS = {"GET", "DELETE"}
message = "Update failed"
