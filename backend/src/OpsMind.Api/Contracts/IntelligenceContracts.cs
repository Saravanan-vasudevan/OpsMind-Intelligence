using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace OpsMind.Api.Contracts;

public class ImportUploadRequest
{
    [Required]
    public IFormFile? File { get; set; }

    /// <summary>production or downtime.</summary>
    [Required]
    public string? Kind { get; set; }

    /// <summary>skip (default) leaves existing rows alone; update overwrites rows whose natural key already exists.</summary>
    public string? ConflictPolicy { get; set; }

    /// <summary>When true, a file with any invalid row is rejected as a whole instead of loading the valid rows.</summary>
    public bool Strict { get; set; }
}

public record ImportBatchDto(
    Guid Id, string Kind, string FileName, string SourceFormat, string ConflictPolicy, bool Strict, string Status,
    int TotalRows, int InsertedRows, int UpdatedRows, int SkippedRows, int RejectedRows, bool ErrorsTruncated,
    string? Message, string? UploadedBy, DateTime StartedAt, DateTime? CompletedAt);

public record ImportErrorDto(int RowNumber, string? Column, string Code, string Message, string? RawValue);

public class ImportListQuery
{
    public string? Kind { get; set; }
    public string? Status { get; set; }
    public int? Page { get; set; }
    public int? PageSize { get; set; }
}

public class ImportErrorQuery
{
    public int? Page { get; set; }
    public int? PageSize { get; set; }
}

/// <summary>Raw row of fn_equipment_reliability (snake_case columns); mapped to <see cref="EquipmentReliabilityRow"/> for the API.</summary>
public class ReliabilityDbRow
{
    [Column("equipment_id")] public Guid EquipmentId { get; set; }
    [Column("asset_code")] public string AssetCode { get; set; } = string.Empty;
    [Column("equipment_name")] public string EquipmentName { get; set; } = string.Empty;
    [Column("plant_id")] public Guid PlantId { get; set; }
    [Column("plant_name")] public string PlantName { get; set; } = string.Empty;
    [Column("line_name")] public string LineName { get; set; } = string.Empty;
    [Column("failures")] public int Failures { get; set; }
    [Column("unplanned_minutes")] public decimal UnplannedMinutes { get; set; }
    [Column("planned_minutes")] public decimal PlannedMinutes { get; set; }
    [Column("run_minutes")] public long RunMinutes { get; set; }
    [Column("scheduled_minutes")] public long ScheduledMinutes { get; set; }
    [Column("mtbf_minutes")] public decimal? MtbfMinutes { get; set; }
    [Column("mttr_minutes")] public decimal? MttrMinutes { get; set; }
    [Column("availability")] public decimal? Availability { get; set; }
    [Column("downtime_rank_in_plant")] public int DowntimeRankInPlant { get; set; }
    [Column("pct_of_plant_unplanned")] public decimal? PctOfPlantUnplanned { get; set; }
    [Column("cumulative_pct_of_plant")] public decimal? CumulativePctOfPlant { get; set; }
}

/// <summary>MTBF/MTTR are null (shown as —) when there was no failure; availability is null when nothing was scheduled.</summary>
public record EquipmentReliabilityRow(
    Guid EquipmentId, string AssetCode, string EquipmentName, Guid PlantId, string PlantName, string LineName,
    int Failures, decimal UnplannedMinutes, decimal PlannedMinutes, long RunMinutes, long ScheduledMinutes,
    decimal? MtbfMinutes, decimal? MttrMinutes, decimal? Availability, int DowntimeRankInPlant,
    decimal? PctOfPlantUnplanned, decimal? CumulativePctOfPlant);
