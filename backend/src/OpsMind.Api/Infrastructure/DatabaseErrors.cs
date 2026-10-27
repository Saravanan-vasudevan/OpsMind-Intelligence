namespace OpsMind.Api.Infrastructure;

public static class DatabaseErrors
{
    /// <summary>
    /// Maps a PostgreSQL SQLSTATE to an HTTP response. Note that ON DELETE RESTRICT reports 23001,
    /// while a missing parent on insert reports 23503.
    /// </summary>
    public static (int Status, string Title, string Detail)? FromSqlState(string? sqlState) => sqlState switch
    {
        "23505" => (StatusCodes.Status409Conflict, "Duplicate value", "A record with the same unique values already exists."),
        "23001" => (StatusCodes.Status409Conflict, "Record in use", "This record is referenced by other data and cannot be deleted."),
        "23503" => (StatusCodes.Status400BadRequest, "Invalid reference", "A referenced record does not exist."),
        "23514" => (StatusCodes.Status400BadRequest, "Value not allowed", "A value breaks a data rule enforced by the database."),
        "23502" => (StatusCodes.Status400BadRequest, "Missing value", "A required value is missing."),
        _ => null
    };
}
