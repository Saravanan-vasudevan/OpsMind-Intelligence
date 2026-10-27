using OpsMind.Api.Domain;

namespace OpsMind.Api.Services;

/// <summary>Business rules for production records that the database cannot express in a single-table constraint.</summary>
public static class ProductionRecordRules
{
    public static IEnumerable<(string Field, string Message)> ValidateValues(
        int runMinutes, int? inspectedUnits, int? rejectedUnits, int shiftDurationMinutes)
    {
        if (runMinutes > shiftDurationMinutes)
        {
            yield return ("RunMinutes", $"Run minutes ({runMinutes}) cannot exceed the shift length ({shiftDurationMinutes} minutes).");
        }

        if (inspectedUnits.HasValue != rejectedUnits.HasValue)
        {
            yield return ("InspectedUnits", "Enter both inspected and rejected units, or neither.");
        }
        else if (inspectedUnits.HasValue && rejectedUnits!.Value > inspectedUnits.Value)
        {
            yield return ("RejectedUnits", "Rejected units cannot exceed inspected units.");
        }
    }

    public static IEnumerable<(string Field, string Message)> ValidateContext(
        EquipmentStatus equipmentStatus, Guid equipmentPlantId, Guid shiftPlantId, DateOnly shiftDate, DateOnly today)
    {
        if (equipmentStatus == EquipmentStatus.Inactive)
        {
            yield return ("EquipmentId", "Inactive equipment cannot receive new production records.");
        }

        if (equipmentPlantId != shiftPlantId)
        {
            yield return ("ShiftId", "This shift belongs to a different plant than the selected equipment.");
        }

        if (shiftDate > today.AddDays(1))
        {
            yield return ("ShiftDate", "Shift date cannot be in the future.");
        }
    }
}
