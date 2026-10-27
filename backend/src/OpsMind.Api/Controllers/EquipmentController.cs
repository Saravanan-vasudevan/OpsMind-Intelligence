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

[Route("api/equipment")]
public class EquipmentController : ApiControllerBase
{
    private static readonly Expression<Func<Equipment, EquipmentDto>> ToDto = e => new EquipmentDto(
        e.Id, e.ProductionLineId, e.ProductionLine.Name, e.ProductionLine.PlantId, e.ProductionLine.Plant.Name,
        e.CategoryId, e.Category.Name, e.AssetCode, e.Name, e.IdealRatePerHour, e.CommissionedOn, e.Status);

    private readonly OpsMindDbContext _db;
    private readonly AuditService _audit;

    public EquipmentController(OpsMindDbContext db, AuditService audit)
    {
        _db = db;
        _audit = audit;
    }

    [HttpGet]
    public async Task<ActionResult<PagedResult<EquipmentDto>>> List(
        [FromQuery] Guid? plantId,
        [FromQuery] Guid? lineId,
        [FromQuery] Guid? categoryId,
        [FromQuery] string? search,
        [FromQuery] int? page,
        [FromQuery] int? pageSize,
        CancellationToken ct)
    {
        var (pageNumber, size) = Paging.Normalise(page, pageSize);

        var query = _db.EquipmentItems.AsNoTracking().AsQueryable();
        if (plantId is { } pid) query = query.Where(e => e.ProductionLine.PlantId == pid);
        if (lineId is { } lid) query = query.Where(e => e.ProductionLineId == lid);
        if (categoryId is { } cid) query = query.Where(e => e.CategoryId == cid);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{EscapeLike(search.Trim())}%";
            query = query.Where(e => EF.Functions.ILike(e.Name, pattern) || EF.Functions.ILike(e.AssetCode, pattern));
        }

        var total = await query.CountAsync(ct);
        var items = await query
            .OrderBy(e => e.ProductionLine.Plant.Name).ThenBy(e => e.ProductionLine.Name).ThenBy(e => e.AssetCode)
            .Skip((pageNumber - 1) * size).Take(size)
            .Select(ToDto)
            .ToListAsync(ct);

        return new PagedResult<EquipmentDto>(items, pageNumber, size, total);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<EquipmentDto>> Get(Guid id, CancellationToken ct)
    {
        var equipment = await _db.EquipmentItems.AsNoTracking().Where(e => e.Id == id).Select(ToDto).FirstOrDefaultAsync(ct);
        if (equipment is null) return NotFound();
        return equipment;
    }

    [HttpPost]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<ActionResult<EquipmentDto>> Create(EquipmentRequest request, CancellationToken ct)
    {
        if (!await _db.ProductionLines.AnyAsync(l => l.Id == request.ProductionLineId, ct))
            return FieldError(nameof(request.ProductionLineId), "Production line not found.");
        if (!await _db.EquipmentCategories.AnyAsync(c => c.Id == request.CategoryId, ct))
            return FieldError(nameof(request.CategoryId), "Category not found.");

        var assetCode = request.AssetCode.Trim().ToUpperInvariant();
        if (await _db.EquipmentItems.AnyAsync(e => e.ProductionLineId == request.ProductionLineId && e.AssetCode == assetCode, ct))
            return ConflictProblem($"Asset code '{assetCode}' is already used on this line.");

        var equipment = new Equipment
        {
            Id = Guid.NewGuid(),
            ProductionLineId = request.ProductionLineId,
            CategoryId = request.CategoryId,
            AssetCode = assetCode,
            Name = request.Name.Trim(),
            IdealRatePerHour = request.IdealRatePerHour,
            CommissionedOn = request.CommissionedOn,
            Status = request.Status
        };

        _db.EquipmentItems.Add(equipment);
        _audit.Add("equipment.create", nameof(Equipment), equipment.Id, new { equipment.AssetCode, equipment.Name });
        await _db.SaveChangesAsync(ct);

        var dto = await _db.EquipmentItems.AsNoTracking().Where(e => e.Id == equipment.Id).Select(ToDto).FirstAsync(ct);
        return CreatedAtAction(nameof(Get), new { id = equipment.Id }, dto);
    }

    [HttpPut("{id:guid}")]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<ActionResult<EquipmentDto>> Update(Guid id, EquipmentRequest request, CancellationToken ct)
    {
        var equipment = await _db.EquipmentItems.Include(e => e.ProductionLine).FirstOrDefaultAsync(e => e.Id == id, ct);
        if (equipment is null) return NotFound();

        if (request.ProductionLineId != equipment.ProductionLineId)
        {
            var newLine = await _db.ProductionLines.FirstOrDefaultAsync(l => l.Id == request.ProductionLineId, ct);
            if (newLine is null)
                return FieldError(nameof(request.ProductionLineId), "Production line not found.");
            // Records pair equipment with shifts of the same plant, so equipment can only move within its plant.
            if (newLine.PlantId != equipment.ProductionLine.PlantId)
                return FieldError(nameof(request.ProductionLineId), "Equipment can only move to another line in the same plant.");
        }

        if (!await _db.EquipmentCategories.AnyAsync(c => c.Id == request.CategoryId, ct))
            return FieldError(nameof(request.CategoryId), "Category not found.");

        var assetCode = request.AssetCode.Trim().ToUpperInvariant();
        if (await _db.EquipmentItems.AnyAsync(e => e.Id != id && e.ProductionLineId == request.ProductionLineId && e.AssetCode == assetCode, ct))
            return ConflictProblem($"Asset code '{assetCode}' is already used on this line.");

        equipment.ProductionLineId = request.ProductionLineId;
        equipment.CategoryId = request.CategoryId;
        equipment.AssetCode = assetCode;
        equipment.Name = request.Name.Trim();
        equipment.IdealRatePerHour = request.IdealRatePerHour;
        equipment.CommissionedOn = request.CommissionedOn;
        equipment.Status = request.Status;

        _audit.Add("equipment.update", nameof(Equipment), equipment.Id, new { equipment.AssetCode, equipment.Name, Status = equipment.Status.ToString() });
        await _db.SaveChangesAsync(ct);

        return await _db.EquipmentItems.AsNoTracking().Where(e => e.Id == id).Select(ToDto).FirstAsync(ct);
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var equipment = await _db.EquipmentItems.FirstOrDefaultAsync(e => e.Id == id, ct);
        if (equipment is null) return NotFound();

        if (await _db.ProductionRecords.AnyAsync(r => r.EquipmentId == id, ct) || await _db.DowntimeEvents.AnyAsync(d => d.EquipmentId == id, ct))
            return ConflictProblem("This equipment has production or downtime history. Set its status to Inactive instead of deleting it.");

        _db.EquipmentItems.Remove(equipment);
        _audit.Add("equipment.delete", nameof(Equipment), equipment.Id, new { equipment.AssetCode, equipment.Name });
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    private static string EscapeLike(string value) =>
        value.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
}
