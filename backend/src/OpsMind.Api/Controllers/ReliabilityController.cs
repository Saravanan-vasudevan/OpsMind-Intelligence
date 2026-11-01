using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OpsMind.Api.Auth;
using OpsMind.Api.Contracts;
using OpsMind.Api.Data;
using OpsMind.Api.Services;

namespace OpsMind.Api.Controllers;

/// <summary>Equipment reliability from the SQL function fn_equipment_reliability (CTEs and window functions; see database/migrations/002).</summary>
[Route("api/analytics/reliability")]
public class ReliabilityController : ApiControllerBase
{
    private readonly OpsMindDbContext _db;
    private readonly ICurrentUser _current;

    public ReliabilityController(OpsMindDbContext db, ICurrentUser current)
    {
        _db = db;
        _current = current;
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<EquipmentReliabilityRow>>> Get([FromQuery] AnalyticsFilter filter, CancellationToken ct)
    {
        var error = QueryFilters.NormaliseRange(filter, Today);
        if (error is not null) return FieldError(nameof(filter.From), error);

        // Raw SQL bypasses the EF tenant filter, so the organisation comes from the validated token and is passed as a parameter.
        var organisationId = _current.OrganisationId!.Value;
        var fromDate = filter.From!.Value;
        var toDate = filter.To!.Value;
        var rows = await _db.Database
            .SqlQuery<ReliabilityDbRow>($"SELECT * FROM fn_equipment_reliability({organisationId}, {fromDate}, {toDate})")
            .ToListAsync(ct);

        return Ok(rows
            .Where(r => filter.PlantId is null || r.PlantId == filter.PlantId)
            .Where(r => filter.EquipmentId is null || r.EquipmentId == filter.EquipmentId)
            .Select(r => new EquipmentReliabilityRow(r.EquipmentId, r.AssetCode, r.EquipmentName, r.PlantId, r.PlantName, r.LineName,
                r.Failures, r.UnplannedMinutes, r.PlannedMinutes, r.RunMinutes, r.ScheduledMinutes, r.MtbfMinutes, r.MttrMinutes,
                r.Availability, r.DowntimeRankInPlant, r.PctOfPlantUnplanned, r.CumulativePctOfPlant))
            .ToList());
    }
}
