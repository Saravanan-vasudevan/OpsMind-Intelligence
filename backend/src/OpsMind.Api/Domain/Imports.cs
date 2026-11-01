namespace OpsMind.Api.Domain;

/// <summary>
/// One processed upload. Rows are written by the Python ETL service (services/intelligence); the API only reads them.
/// Kind, source format, conflict policy and status are stored as text and constrained by CHECKs in migration 002.
/// </summary>
public class ImportBatch
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    public string Kind { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string FileSha256 { get; set; } = string.Empty;
    public string SourceFormat { get; set; } = string.Empty;
    public string ConflictPolicy { get; set; } = string.Empty;
    public bool Strict { get; set; }
    public string Status { get; set; } = string.Empty;
    public int TotalRows { get; set; }
    public int InsertedRows { get; set; }
    public int UpdatedRows { get; set; }
    public int SkippedRows { get; set; }
    public int RejectedRows { get; set; }
    public bool ErrorsTruncated { get; set; }
    public string? Message { get; set; }
    public Guid? CreatedBy { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}

public class ImportError
{
    public long Id { get; set; }
    public Guid BatchId { get; set; }
    public ImportBatch Batch { get; set; } = null!;
    public int RowNumber { get; set; }
    public string? ColumnName { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string? RawValue { get; set; }
}
