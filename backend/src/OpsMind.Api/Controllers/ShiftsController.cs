using System.Linq.Expressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OpsMind.Api.Auth;
using OpsMind.Api.Contracts;
using OpsMind.Api.Data;
using OpsMind.Api.Domain;
using OpsMind.Api.Services;

namespace OpsMind.Api.Controllers;

[Route("api/shifts")]
public class ShiftsController : ApiControllerBase
{
    private static readonly Expression<Func<Shift, ShiftDto>> ToDto = s => new ShiftDto(
        s.Id, s.PlantId, s.Plant.Name, s.Name, s.StartTime, s.EndTime, s.DurationMinutes);

    private readonly OpsMindDbContext _db;
    private readonly AuditService _audit;

    public ShiftsController(OpsMindDbContext db, AuditService audit)
    {
        _db = db;
        _audit = audit;
    }

    [HttpGet]
    public async Task<ActionResult<List<ShiftDto>>> List([FromQuery] Guid? plantId, CancellationToken ct)
    {
        var query = _db.Shifts.AsNoTracking().AsQueryable();
        if (plantId is { } pid) query = query.Where(s => s.PlantId == pid);
        return await query.OrderBy(s => s.Plant.Name).ThenBy(s => s.StartTime).Select(ToDto).ToListAsync(ct);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ShiftDto>> Get(Guid id, CancellationToken ct)
    {
        var shift = await _db.Shifts.AsNoTracking().Where(s => s.Id == id).Select(ToDto).FirstOrDefaultAsync(ct);
        if (shift is null) return NotFound();
        return shift;
    }

    [HttpPost]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<ActionResult<ShiftDto>> Create(ShiftRequest request, CancellationToken ct)
    {
        if (request.StartTime == request.EndTime)
            return FieldError(nameof(request.EndTime), "Start and end time must be different.");
        if (!await _db.Plants.AnyAsync(p => p.Id == request.PlantId, ct))
            return FieldError(nameof(request.PlantId), "Plant not found.");

        var name = request.Name.Trim();
        if (await _db.Shifts.AnyAsync(s => s.PlantId == request.PlantId && s.Name == name, ct))
            return ConflictProblem($"A shift named '{name}' already exists in this plant.");

        var shift = new Shift { Id = Guid.NewGuid(), PlantId = request.PlantId, Name = name, StartTime = request.StartTime, EndTime = request.EndTime };
        _db.Shifts.Add(shift);
        _audit.Add("shift.create", nameof(Shift), shift.Id, new { shift.Name });
        await _db.SaveChangesAsync(ct);

        var dto = await _db.Shifts.AsNoTracking().Where(s => s.Id == shift.Id).Select(ToDto).FirstAsync(ct);
        return CreatedAtAction(nameof(Get), new { id = shift.Id }, dto);
    }

    /// <summary>Changing times does not re-validate existing records against the new shift length.</summary>
    [HttpPut("{id:guid}")]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<ActionResult<ShiftDto>> Update(Guid id, ShiftRequest request, CancellationToken ct)
    {
        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (shift is null) return NotFound();

        if (request.PlantId != shift.PlantId)
            return FieldError(nameof(request.PlantId), "A shift cannot be moved to a different plant.");
        if (request.StartTime == request.EndTime)
            return FieldError(nameof(request.EndTime), "Start and end time must be different.");

        var name = request.Name.Trim();
        if (await _db.Shifts.AnyAsync(s => s.Id != id && s.PlantId == shift.PlantId && s.Name == name, ct))
            return ConflictProblem($"A shift named '{name}' already exists in this plant.");

        shift.Name = name;
        shift.StartTime = request.StartTime;
        shift.EndTime = request.EndTime;
        _audit.Add("shift.update", nameof(Shift), shift.Id, new { shift.Name });
        await _db.SaveChangesAsync(ct);

        return await _db.Shifts.AsNoTracking().Where(s => s.Id == id).Select(ToDto).FirstAsync(ct);
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (shift is null) return NotFound();

        if (await _db.ProductionRecords.AnyAsync(r => r.ShiftId == id, ct))
            return ConflictProblem("Production records exist for this shift, so it cannot be deleted.");

        _db.Shifts.Remove(shift);
        _audit.Add("shift.delete", nameof(Shift), shift.Id, new { shift.Name });
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }
}
