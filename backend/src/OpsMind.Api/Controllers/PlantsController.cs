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

[Route("api/plants")]
public class PlantsController : ApiControllerBase
{
    private static readonly Expression<Func<Plant, PlantDto>> ToDto = p => new PlantDto(
        p.Id, p.Name, p.Code, p.Location, p.TimeZone,
        p.Lines.Count, p.Shifts.Count, p.Lines.SelectMany(l => l.Equipment).Count());

    private readonly OpsMindDbContext _db;
    private readonly ICurrentUser _current;
    private readonly AuditService _audit;

    public PlantsController(OpsMindDbContext db, ICurrentUser current, AuditService audit)
    {
        _db = db;
        _current = current;
        _audit = audit;
    }

    [HttpGet]
    public async Task<ActionResult<List<PlantDto>>> List(CancellationToken ct) =>
        await _db.Plants.AsNoTracking().OrderBy(p => p.Name).Select(ToDto).ToListAsync(ct);

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<PlantDto>> Get(Guid id, CancellationToken ct)
    {
        var plant = await _db.Plants.AsNoTracking().Where(p => p.Id == id).Select(ToDto).FirstOrDefaultAsync(ct);
        if (plant is null) return NotFound();
        return plant;
    }

    [HttpPost]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<ActionResult<PlantDto>> Create(PlantRequest request, CancellationToken ct)
    {
        var code = request.Code.Trim().ToUpperInvariant();
        var name = request.Name.Trim();

        if (await _db.Plants.AnyAsync(p => p.Code == code, ct))
            return ConflictProblem($"Plant code '{code}' is already in use.");
        if (await _db.Plants.AnyAsync(p => p.Name == name, ct))
            return ConflictProblem($"A plant named '{name}' already exists.");

        var plant = new Plant
        {
            Id = Guid.NewGuid(),
            OrganisationId = _current.OrganisationId!.Value,
            Name = name,
            Code = code,
            Location = NullIfBlank(request.Location),
            TimeZone = request.TimeZone.Trim()
        };

        _db.Plants.Add(plant);
        _audit.Add("plant.create", nameof(Plant), plant.Id, new { plant.Code, plant.Name });
        await _db.SaveChangesAsync(ct);

        var dto = new PlantDto(plant.Id, plant.Name, plant.Code, plant.Location, plant.TimeZone, 0, 0, 0);
        return CreatedAtAction(nameof(Get), new { id = plant.Id }, dto);
    }

    [HttpPut("{id:guid}")]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<ActionResult<PlantDto>> Update(Guid id, PlantRequest request, CancellationToken ct)
    {
        var plant = await _db.Plants.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (plant is null) return NotFound();

        var code = request.Code.Trim().ToUpperInvariant();
        var name = request.Name.Trim();

        if (await _db.Plants.AnyAsync(p => p.Id != id && p.Code == code, ct))
            return ConflictProblem($"Plant code '{code}' is already in use.");
        if (await _db.Plants.AnyAsync(p => p.Id != id && p.Name == name, ct))
            return ConflictProblem($"A plant named '{name}' already exists.");

        plant.Name = name;
        plant.Code = code;
        plant.Location = NullIfBlank(request.Location);
        plant.TimeZone = request.TimeZone.Trim();

        _audit.Add("plant.update", nameof(Plant), plant.Id, new { plant.Code, plant.Name });
        await _db.SaveChangesAsync(ct);

        return await _db.Plants.AsNoTracking().Where(p => p.Id == id).Select(ToDto).FirstAsync(ct);
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var plant = await _db.Plants.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (plant is null) return NotFound();

        if (await _db.ProductionLines.AnyAsync(l => l.PlantId == id, ct) || await _db.Shifts.AnyAsync(s => s.PlantId == id, ct))
            return ConflictProblem("This plant still has production lines or shifts. Remove them first.");

        _db.Plants.Remove(plant);
        _audit.Add("plant.delete", nameof(Plant), plant.Id, new { plant.Code, plant.Name });
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }
}
