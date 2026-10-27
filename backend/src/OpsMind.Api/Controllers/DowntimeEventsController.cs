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

[Route("api/downtime-events")]
public class DowntimeEventsController : ApiControllerBase
{
    private const int MaxDurationHours = 24 * 7;

    private static readonly Expression<Func<DowntimeEvent, DowntimeDto>> ToDto = d => new DowntimeDto(
        d.Id, d.EquipmentId, d.Equipment.Name, d.Equipment.AssetCode, d.Equipment.ProductionLine.Plant.Name,
        d.StartTime, d.EndTime, d.DurationMinutes, d.Category, d.ReasonCode, d.Notes);

    private readonly OpsMindDbContext _db;
    private readonly ICurrentUser _current;
    private readonly AuditService _audit;

    public DowntimeEventsController(OpsMindDbContext db, ICurrentUser current, AuditService audit)
    {
        _db = db;
        _current = current;
        _audit = audit;
    }

    [HttpGet]
    public async Task<ActionResult<PagedResult<DowntimeDto>>> List([FromQuery] DowntimeQuery query, CancellationToken ct)
    {
        var (page, size) = Paging.Normalise(query.Page, query.PageSize);

        var events = _db.DowntimeEvents.AsNoTracking().Apply(query);
        if (query.Category is { } category) events = events.Where(d => d.Category == category);

        var total = await events.CountAsync(ct);
        var items = await events
            .OrderByDescending(d => d.StartTime)
            .Skip((page - 1) * size).Take(size)
            .Select(ToDto)
            .ToListAsync(ct);

        return new PagedResult<DowntimeDto>(items, page, size, total);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<DowntimeDto>> Get(Guid id, CancellationToken ct)
    {
        var item = await _db.DowntimeEvents.AsNoTracking().Where(d => d.Id == id).Select(ToDto).FirstOrDefaultAsync(ct);
        if (item is null) return NotFound();
        return item;
    }

    [HttpPost]
    public async Task<ActionResult<DowntimeDto>> Create(DowntimeRequest request, CancellationToken ct)
    {
        if (!await _db.EquipmentItems.AnyAsync(e => e.Id == request.EquipmentId, ct))
            return FieldError(nameof(request.EquipmentId), "Equipment not found.");

        var start = request.StartTime.UtcDateTime;
        var end = request.EndTime.UtcDateTime;
        var error = ValidateTimes(start, end);
        if (error is not null) return FieldError(nameof(request.EndTime), error);

        if (await Overlaps(request.EquipmentId, start, end, null, ct))
            return ConflictProblem("This downtime overlaps another downtime event for the same equipment.");

        var item = new DowntimeEvent
        {
            Id = Guid.NewGuid(),
            EquipmentId = request.EquipmentId,
            StartTime = start,
            EndTime = end,
            Category = request.Category,
            ReasonCode = request.ReasonCode.Trim().ToUpperInvariant(),
            Notes = NullIfBlank(request.Notes),
            CreatedBy = _current.UserId
        };

        _db.DowntimeEvents.Add(item);
        _audit.Add("downtime.create", nameof(DowntimeEvent), item.Id,
            new { request.EquipmentId, item.ReasonCode, Category = item.Category.ToString() });
        await _db.SaveChangesAsync(ct);

        var dto = await _db.DowntimeEvents.AsNoTracking().Where(d => d.Id == item.Id).Select(ToDto).FirstAsync(ct);
        return CreatedAtAction(nameof(Get), new { id = item.Id }, dto);
    }

    [HttpPut("{id:guid}")]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<ActionResult<DowntimeDto>> Update(Guid id, DowntimeRequest request, CancellationToken ct)
    {
        var item = await _db.DowntimeEvents.FirstOrDefaultAsync(d => d.Id == id, ct);
        if (item is null) return NotFound();

        if (request.EquipmentId != item.EquipmentId)
            return FieldError(nameof(request.EquipmentId), "The equipment of a downtime event cannot be changed.");

        var start = request.StartTime.UtcDateTime;
        var end = request.EndTime.UtcDateTime;
        var error = ValidateTimes(start, end);
        if (error is not null) return FieldError(nameof(request.EndTime), error);

        if (await Overlaps(item.EquipmentId, start, end, id, ct))
            return ConflictProblem("This downtime overlaps another downtime event for the same equipment.");

        item.StartTime = start;
        item.EndTime = end;
        item.Category = request.Category;
        item.ReasonCode = request.ReasonCode.Trim().ToUpperInvariant();
        item.Notes = NullIfBlank(request.Notes);

        _audit.Add("downtime.update", nameof(DowntimeEvent), item.Id, new { item.ReasonCode, Category = item.Category.ToString() });
        await _db.SaveChangesAsync(ct);

        return await _db.DowntimeEvents.AsNoTracking().Where(d => d.Id == id).Select(ToDto).FirstAsync(ct);
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Policies.AdminOnly)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var item = await _db.DowntimeEvents.FirstOrDefaultAsync(d => d.Id == id, ct);
        if (item is null) return NotFound();

        _db.DowntimeEvents.Remove(item);
        _audit.Add("downtime.delete", nameof(DowntimeEvent), item.Id, new { item.EquipmentId, item.ReasonCode });
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    private static string? ValidateTimes(DateTime start, DateTime end)
    {
        if (end <= start) return "End time must be after start time.";
        if ((end - start).TotalHours > MaxDurationHours) return $"A single downtime event cannot be longer than {MaxDurationHours / 24} days.";
        if (start > DateTime.UtcNow.AddDays(1)) return "Start time cannot be in the future.";
        return null;
    }

    /// <summary>Overlapping events for one machine would double-count downtime, so they are rejected here.</summary>
    private Task<bool> Overlaps(Guid equipmentId, DateTime start, DateTime end, Guid? ignoreId, CancellationToken ct) =>
        _db.DowntimeEvents.AnyAsync(d =>
            d.EquipmentId == equipmentId && d.Id != ignoreId && d.StartTime < end && d.EndTime > start, ct);
}
