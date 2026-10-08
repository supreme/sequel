class Queries
{
    const string Find = "SELECT Id, Name FROM People WHERE Id = @id";
    string Update(string table) => $"UPDATE {table} SET Seen = GETDATE() WHERE Name = @name";
    const string Report = @"
        SELECT Name, COUNT(*)
        FROM Orders -- all time
        GROUP BY Name";
}
