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

[Route("api/lines")]
public class LinesController : ApiControllerBase
{
    private static readonly Expression<Func<ProductionLine, LineDto>> ToDto = l => new LineDto(
        l.Id, l.PlantId, l.Plant.Name, l.Name, l.Code, l.Equipment.Count);

    private readonly OpsMindDbContext _db;
    private readonly AuditService _audit;

    public LinesController(OpsMindDbContext db, AuditService audit)
    {
        _db = db;
        _audit = audit;
    }

    [HttpGet]
    public async Task<ActionResult<List<LineDto>>> List([FromQuery] Guid? plantId, CancellationToken ct)
    {
        var query = _db.ProductionLines.AsNoTracking().AsQueryable();
        if (plantId is { } pid) query = query.Where(l => l.PlantId == pid);
        return await query.OrderBy(l => l.Plant.Name).ThenBy(l => l.Name).Select(ToDto).ToListAsync(ct);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<LineDto>> Get(Guid id, CancellationToken ct)
    {
        var line = await _db.ProductionLines.AsNoTracking().Where(l => l.Id == id).Select(ToDto).FirstOrDefaultAsync(ct);
        if (line is null) return NotFound();
        return line;
    }

    [HttpPost]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<ActionResult<LineDto>> Create(LineRequest request, CancellationToken ct)
    {
        if (!await _db.Plants.AnyAsync(p => p.Id == request.PlantId, ct))
            return FieldError(nameof(request.PlantId), "Plant not found.");

        var code = request.Code.Trim().ToUpperInvariant();
        if (await _db.ProductionLines.AnyAsync(l => l.PlantId == request.PlantId && l.Code == code, ct))
            return ConflictProblem($"Line code '{code}' is already used in this plant.");

        var line = new ProductionLine { Id = Guid.NewGuid(), PlantId = request.PlantId, Name = request.Name.Trim(), Code = code };
        _db.ProductionLines.Add(line);
        _audit.Add("line.create", nameof(ProductionLine), line.Id, new { line.Code, line.Name });
        await _db.SaveChangesAsync(ct);

        var dto = await _db.ProductionLines.AsNoTracking().Where(l => l.Id == line.Id).Select(ToDto).FirstAsync(ct);
        return CreatedAtAction(nameof(Get), new { id = line.Id }, dto);
    }

    [HttpPut("{id:guid}")]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<ActionResult<LineDto>> Update(Guid id, LineRequest request, CancellationToken ct)
    {
        var line = await _db.ProductionLines.FirstOrDefaultAsync(l => l.Id == id, ct);
        if (line is null) return NotFound();

        // Records link equipment and shifts of the same plant, so a line cannot move between plants.
        if (request.PlantId != line.PlantId)
            return FieldError(nameof(request.PlantId), "A line cannot be moved to a different plant.");

        var code = request.Code.Trim().ToUpperInvariant();
        if (await _db.ProductionLines.AnyAsync(l => l.Id != id && l.PlantId == line.PlantId && l.Code == code, ct))
            return ConflictProblem($"Line code '{code}' is already used in this plant.");

        line.Name = request.Name.Trim();
        line.Code = code;
        _audit.Add("line.update", nameof(ProductionLine), line.Id, new { line.Code, line.Name });
        await _db.SaveChangesAsync(ct);

        return await _db.ProductionLines.AsNoTracking().Where(l => l.Id == id).Select(ToDto).FirstAsync(ct);
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var line = await _db.ProductionLines.FirstOrDefaultAsync(l => l.Id == id, ct);
        if (line is null) return NotFound();

        if (await _db.EquipmentItems.AnyAsync(e => e.ProductionLineId == id, ct))
            return ConflictProblem("This line still has equipment. Move or delete the equipment first.");

        _db.ProductionLines.Remove(line);
        _audit.Add("line.delete", nameof(ProductionLine), line.Id, new { line.Code, line.Name });
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }
}
