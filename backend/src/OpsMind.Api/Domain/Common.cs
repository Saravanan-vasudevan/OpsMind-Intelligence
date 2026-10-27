namespace OpsMind.Api.Domain;

public enum UserRole
{
    Admin,
    User
}

public enum EquipmentStatus
{
    Active,
    Inactive,
    Maintenance
}

public enum DowntimeCategory
{
    Planned,
    Unplanned
}

public interface IHasUpdatedAt
{
    DateTime UpdatedAt { get; set; }
}
