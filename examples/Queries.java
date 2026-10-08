class Queries {
    static final String FIND = "SELECT id, name FROM people WHERE id = ?";
    static final String REPORT = """
        SELECT name, count(*)
        FROM orders -- all time
        GROUP BY name
        """;
    static final String GREETING = """
        Hello there
        """;
}
