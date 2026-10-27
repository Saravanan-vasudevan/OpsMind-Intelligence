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

[Route("api/production-records")]
public class ProductionRecordsController : ApiControllerBase
{
    private static readonly Expression<Func<ProductionRecord, ProductionRecordDto>> ToDto = p => new ProductionRecordDto(
        p.Id,
        p.EquipmentId,
        p.Equipment.Name,
        p.Equipment.AssetCode,
        p.Equipment.ProductionLine.PlantId,
        p.Equipment.ProductionLine.Plant.Name,
        p.Equipment.ProductionLineId,
        p.Equipment.ProductionLine.Name,
        p.ShiftId,
        p.Shift.Name,
        p.ShiftDate,
        p.UnitsProduced,
        p.TargetUnits,
        p.RunMinutes,
        p.Quality == null ? (int?)null : p.Quality.InspectedUnits,
        p.Quality == null ? (int?)null : p.Quality.RejectedUnits,
        p.Quality == null ? null : p.Quality.DefectType,
        p.Notes);

    private readonly OpsMindDbContext _db;
    private readonly ICurrentUser _current;
    private readonly AuditService _audit;

    public ProductionRecordsController(OpsMindDbContext db, ICurrentUser current, AuditService audit)
    {
        _db = db;
        _current = current;
        _audit = audit;
    }

    [HttpGet]
    public async Task<ActionResult<PagedResult<ProductionRecordDto>>> List([FromQuery] RecordQuery query, CancellationToken ct)
    {
        var (page, size) = Paging.Normalise(query.Page, query.PageSize);

        var records = _db.ProductionRecords.AsNoTracking().Apply(query);
        if (query.ShiftId is { } shiftId) records = records.Where(p => p.ShiftId == shiftId);

        var total = await records.CountAsync(ct);
        var items = await records
            .OrderByDescending(p => p.ShiftDate).ThenBy(p => p.Equipment.Name).ThenBy(p => p.Shift.StartTime)
            .Skip((page - 1) * size).Take(size)
            .Select(ToDto)
            .ToListAsync(ct);

        return new PagedResult<ProductionRecordDto>(items, page, size, total);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ProductionRecordDto>> Get(Guid id, CancellationToken ct)
    {
        var record = await _db.ProductionRecords.AsNoTracking().Where(p => p.Id == id).Select(ToDto).FirstOrDefaultAsync(ct);
        if (record is null) return NotFound();
        return record;
    }

    [HttpPost]
    public async Task<ActionResult<ProductionRecordDto>> Create(ProductionRecordRequest request, CancellationToken ct)
    {
        var equipment = await _db.EquipmentItems.Include(e => e.ProductionLine)
            .FirstOrDefaultAsync(e => e.Id == request.EquipmentId, ct);
        if (equipment is null) return FieldError(nameof(request.EquipmentId), "Equipment not found.");

        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == request.ShiftId, ct);
        if (shift is null) return FieldError(nameof(request.ShiftId), "Shift not found.");

        var errors = ProductionRecordRules
            .ValidateContext(equipment.Status, equipment.ProductionLine.PlantId, shift.PlantId, request.ShiftDate, Today)
            .Concat(ProductionRecordRules.ValidateValues(request.RunMinutes, request.InspectedUnits, request.RejectedUnits, shift.DurationMinutes))
            .ToList();
        if (errors.Count > 0) return FieldErrors(errors);

        if (await _db.ProductionRecords.AnyAsync(p =>
                p.EquipmentId == request.EquipmentId && p.ShiftId == request.ShiftId && p.ShiftDate == request.ShiftDate, ct))
        {
            return ConflictProblem("A production record already exists for this equipment, shift and date.");
        }

        var record = new ProductionRecord
        {
            Id = Guid.NewGuid(),
            EquipmentId = request.EquipmentId,
            ShiftId = request.ShiftId,
            ShiftDate = request.ShiftDate,
            UnitsProduced = request.UnitsProduced,
            TargetUnits = request.TargetUnits,
            RunMinutes = request.RunMinutes,
            Notes = NullIfBlank(request.Notes),
            CreatedBy = _current.UserId
        };

        if (request.InspectedUnits.HasValue)
        {
            record.Quality = new QualityRecord
            {
                Id = Guid.NewGuid(),
                InspectedUnits = request.InspectedUnits.Value,
                RejectedUnits = request.RejectedUnits!.Value,
                DefectType = NullIfBlank(request.DefectType)
            };
        }

        _db.ProductionRecords.Add(record);
        _audit.Add("production.create", nameof(ProductionRecord), record.Id,
            new { request.EquipmentId, request.ShiftDate, request.UnitsProduced });
        await _db.SaveChangesAsync(ct);

        var dto = await _db.ProductionRecords.AsNoTracking().Where(p => p.Id == record.Id).Select(ToDto).FirstAsync(ct);
        return CreatedAtAction(nameof(Get), new { id = record.Id }, dto);
    }

    [HttpPut("{id:guid}")]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<ActionResult<ProductionRecordDto>> Update(Guid id, ProductionRecordUpdateRequest request, CancellationToken ct)
    {
        var record = await _db.ProductionRecords.Include(p => p.Quality).Include(p => p.Shift)
            .FirstOrDefaultAsync(p => p.Id == id, ct);
        if (record is null) return NotFound();

        var errors = ProductionRecordRules
            .ValidateValues(request.RunMinutes, request.InspectedUnits, request.RejectedUnits, record.Shift.DurationMinutes)
            .ToList();
        if (errors.Count > 0) return FieldErrors(errors);

        record.UnitsProduced = request.UnitsProduced;
        record.TargetUnits = request.TargetUnits;
        record.RunMinutes = request.RunMinutes;
        record.Notes = NullIfBlank(request.Notes);

        if (request.InspectedUnits.HasValue)
        {
            if (record.Quality is null)
            {
                record.Quality = new QualityRecord { Id = Guid.NewGuid() };
            }
            record.Quality.InspectedUnits = request.InspectedUnits.Value;
            record.Quality.RejectedUnits = request.RejectedUnits!.Value;
            record.Quality.DefectType = NullIfBlank(request.DefectType);
        }
        else if (record.Quality is not null)
        {
            _db.QualityRecords.Remove(record.Quality);
        }

        _audit.Add("production.update", nameof(ProductionRecord), record.Id, new { request.UnitsProduced, request.RunMinutes });
        await _db.SaveChangesAsync(ct);

        return await _db.ProductionRecords.AsNoTracking().Where(p => p.Id == id).Select(ToDto).FirstAsync(ct);
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var record = await _db.ProductionRecords.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (record is null) return NotFound();

        _db.ProductionRecords.Remove(record);
        _audit.Add("production.delete", nameof(ProductionRecord), record.Id, new { record.EquipmentId, record.ShiftDate });
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }
}
