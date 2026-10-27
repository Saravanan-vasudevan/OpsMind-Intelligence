using System.ComponentModel.DataAnnotations;
using OpsMind.Api.Domain;

namespace OpsMind.Api.Contracts;

/// <summary>Filters shared by analytics, record lists and exports. Dates are inclusive, in UTC.</summary>
public class AnalyticsFilter
{
    public DateOnly? From { get; set; }
    public DateOnly? To { get; set; }
    public Guid? PlantId { get; set; }
    public Guid? LineId { get; set; }
    public Guid? EquipmentId { get; set; }
}

public class RecordQuery : AnalyticsFilter
{
    public Guid? ShiftId { get; set; }
    public int? Page { get; set; }
    public int? PageSize { get; set; }
}

public class DowntimeQuery : AnalyticsFilter
{
    public DowntimeCategory? Category { get; set; }
    public int? Page { get; set; }
    public int? PageSize { get; set; }
}

public class ProductionRecordRequest
{
    [Required]
    public Guid EquipmentId { get; set; }

    [Required]
    public Guid ShiftId { get; set; }

    public DateOnly ShiftDate { get; set; }

    [Range(0, 10_000_000)]
    public int UnitsProduced { get; set; }

    [Range(0, 10_000_000)]
    public int TargetUnits { get; set; }

    [Range(0, 1440)]
    public int RunMinutes { get; set; }

    [Range(0, 10_000_000)]
    public int? InspectedUnits { get; set; }

    [Range(0, 10_000_000)]
    public int? RejectedUnits { get; set; }

    [StringLength(100)]
    public string? DefectType { get; set; }

    [StringLength(500)]
    public string? Notes { get; set; }
}

/// <summary>Equipment, shift and date identify a record and cannot be changed; delete and recreate instead.</summary>
public class ProductionRecordUpdateRequest
{
    [Range(0, 10_000_000)]
    public int UnitsProduced { get; set; }

    [Range(0, 10_000_000)]
    public int TargetUnits { get; set; }

    [Range(0, 1440)]
    public int RunMinutes { get; set; }

    [Range(0, 10_000_000)]
    public int? InspectedUnits { get; set; }

    [Range(0, 10_000_000)]
    public int? RejectedUnits { get; set; }

    [StringLength(100)]
    public string? DefectType { get; set; }

    [StringLength(500)]
    public string? Notes { get; set; }
}

public record ProductionRecordDto(
    Guid Id,
    Guid EquipmentId,
    string EquipmentName,
    string AssetCode,
    Guid PlantId,
    string PlantName,
    Guid LineId,
    string LineName,
    Guid ShiftId,
    string ShiftName,
    DateOnly ShiftDate,
    int UnitsProduced,
    int TargetUnits,
    int RunMinutes,
    int? InspectedUnits,
    int? RejectedUnits,
    string? DefectType,
    string? Notes);

public class DowntimeRequest
{
    [Required]
    public Guid EquipmentId { get; set; }

    public DateTimeOffset StartTime { get; set; }
    public DateTimeOffset EndTime { get; set; }
    public DowntimeCategory Category { get; set; }

    [Required, StringLength(40, MinimumLength = 1), RegularExpression("^[A-Za-z0-9_-]+$", ErrorMessage = "Reason code may contain letters, numbers, hyphen and underscore only.")]
    public string ReasonCode { get; set; } = string.Empty;

    [StringLength(500)]
    public string? Notes { get; set; }
}

public record DowntimeDto(
    Guid Id,
    Guid EquipmentId,
    string EquipmentName,
    string AssetCode,
    string PlantName,
    DateTime StartTime,
    DateTime EndTime,
    decimal DurationMinutes,
    DowntimeCategory Category,
    string ReasonCode,
    string? Notes);

public record KpiSummary(
    int RecordCount,
    long TotalUnits,
    long TotalTargetUnits,
    decimal? TargetAttainment,
    long ScheduledMinutes,
    long RunMinutes,
    decimal? Utilisation,
    decimal PlannedDowntimeMinutes,
    decimal UnplannedDowntimeMinutes,
    decimal? Availability,
    long InspectedUnits,
    long RejectedUnits,
    decimal? DefectRate);

public record TrendPoint(DateOnly Date, long Units, long TargetUnits, long InspectedUnits, long RejectedUnits, decimal? DefectRate);

public record PlantComparisonRow(
    Guid PlantId,
    string PlantName,
    long Units,
    long TargetUnits,
    decimal? TargetAttainment,
    decimal? Utilisation,
    decimal? Availability,
    decimal UnplannedDowntimeMinutes,
    decimal? DefectRate);

public record DowntimeReasonRow(string ReasonCode, DowntimeCategory Category, decimal Minutes, int Events);

public record AuditLogDto(long Id, DateTime CreatedAt, Guid? UserId, string? UserName, string Action, string Entity, string? EntityId, string? Details, string? IpAddress);
