using System.ComponentModel.DataAnnotations;
using OpsMind.Api.Domain;

namespace OpsMind.Api.Contracts;

public class PlantRequest
{
    [Required, StringLength(100, MinimumLength = 2)]
    public string Name { get; set; } = string.Empty;

    [Required, StringLength(20, MinimumLength = 1), RegularExpression("^[A-Za-z0-9_-]+$", ErrorMessage = "Code may contain letters, numbers, hyphen and underscore only.")]
    public string Code { get; set; } = string.Empty;

    [StringLength(200)]
    public string? Location { get; set; }

    [Required, StringLength(64)]
    public string TimeZone { get; set; } = "UTC";
}

public record PlantDto(Guid Id, string Name, string Code, string? Location, string TimeZone, int LineCount, int ShiftCount, int EquipmentCount);

public class LineRequest
{
    [Required]
    public Guid PlantId { get; set; }

    [Required, StringLength(100, MinimumLength = 2)]
    public string Name { get; set; } = string.Empty;

    [Required, StringLength(20, MinimumLength = 1), RegularExpression("^[A-Za-z0-9_-]+$", ErrorMessage = "Code may contain letters, numbers, hyphen and underscore only.")]
    public string Code { get; set; } = string.Empty;
}

public record LineDto(Guid Id, Guid PlantId, string PlantName, string Name, string Code, int EquipmentCount);

public class ShiftRequest
{
    [Required]
    public Guid PlantId { get; set; }

    [Required, StringLength(60, MinimumLength = 1)]
    public string Name { get; set; } = string.Empty;

    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }
}

public record ShiftDto(Guid Id, Guid PlantId, string PlantName, string Name, TimeOnly StartTime, TimeOnly EndTime, int DurationMinutes);

public class CategoryRequest
{
    [Required, StringLength(80, MinimumLength = 2)]
    public string Name { get; set; } = string.Empty;
}

public record CategoryDto(Guid Id, string Name, int EquipmentCount);

public class EquipmentRequest
{
    [Required]
    public Guid ProductionLineId { get; set; }

    [Required]
    public Guid CategoryId { get; set; }

    [Required, StringLength(30, MinimumLength = 1), RegularExpression("^[A-Za-z0-9_-]+$", ErrorMessage = "Asset code may contain letters, numbers, hyphen and underscore only.")]
    public string AssetCode { get; set; } = string.Empty;

    [Required, StringLength(120, MinimumLength = 2)]
    public string Name { get; set; } = string.Empty;

    [Range(0.01, 1_000_000)]
    public decimal? IdealRatePerHour { get; set; }

    public DateOnly? CommissionedOn { get; set; }

    public EquipmentStatus Status { get; set; } = EquipmentStatus.Active;
}

public record EquipmentDto(
    Guid Id,
    Guid ProductionLineId,
    string LineName,
    Guid PlantId,
    string PlantName,
    Guid CategoryId,
    string CategoryName,
    string AssetCode,
    string Name,
    decimal? IdealRatePerHour,
    DateOnly? CommissionedOn,
    EquipmentStatus Status);
