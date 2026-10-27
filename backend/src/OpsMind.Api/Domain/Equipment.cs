namespace OpsMind.Api.Domain;

public class EquipmentCategory
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    public string Name { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }

    public ICollection<Equipment> Equipment { get; set; } = new List<Equipment>();
}

public class Equipment : IHasUpdatedAt
{
    public Guid Id { get; set; }
    public Guid ProductionLineId { get; set; }
    public ProductionLine ProductionLine { get; set; } = null!;
    public Guid CategoryId { get; set; }
    public EquipmentCategory Category { get; set; } = null!;
    public string AssetCode { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public decimal? IdealRatePerHour { get; set; }
    public DateOnly? CommissionedOn { get; set; }
    public EquipmentStatus Status { get; set; } = EquipmentStatus.Active;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
