using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OpsMind.Api.Contracts;
using OpsMind.Api.Data;
using OpsMind.Api.Services;

namespace OpsMind.Api.Controllers;

[Route("api/exports")]
public class ExportsController : ApiControllerBase
{
    private const int MaxRows = 100_000;

    private readonly OpsMindDbContext _db;
    private readonly AuditService _audit;

    public ExportsController(OpsMindDbContext db, AuditService audit)
    {
        _db = db;
        _audit = audit;
    }

    [HttpGet("production-records.csv")]
    public async Task<IActionResult> ProductionRecordsCsv([FromQuery] AnalyticsFilter filter, CancellationToken ct)
    {
        var error = QueryFilters.NormaliseRange(filter, Today);
        if (error is not null) return FieldError(nameof(filter.From), error);

        var rows = await _db.ProductionRecords.AsNoTracking().Apply(filter)
            .OrderBy(p => p.ShiftDate).ThenBy(p => p.Equipment.Name).ThenBy(p => p.Shift.StartTime)
            .Take(MaxRows)
            .Select(p => new
            {
                p.ShiftDate,
                Plant = p.Equipment.ProductionLine.Plant.Name,
                Line = p.Equipment.ProductionLine.Name,
                p.Equipment.AssetCode,
                Equipment = p.Equipment.Name,
                Shift = p.Shift.Name,
                p.UnitsProduced,
                p.TargetUnits,
                p.RunMinutes,
                Inspected = p.Quality == null ? (int?)null : p.Quality.InspectedUnits,
                Rejected = p.Quality == null ? (int?)null : p.Quality.RejectedUnits,
                DefectType = p.Quality == null ? null : p.Quality.DefectType,
                p.Notes
            })
            .ToListAsync(ct);

        // The byte order mark lets Excel open the file as UTF-8.
        var csv = new StringBuilder("﻿");
        csv.AppendLine(CsvWriter.Row("Date", "Plant", "Line", "Asset code", "Equipment", "Shift", "Units produced",
            "Target units", "Run minutes", "Inspected units", "Rejected units", "Defect type", "Notes"));
        foreach (var r in rows)
        {
            csv.AppendLine(CsvWriter.Row(r.ShiftDate, r.Plant, r.Line, r.AssetCode, r.Equipment, r.Shift, r.UnitsProduced,
                r.TargetUnits, r.RunMinutes, r.Inspected, r.Rejected, r.DefectType, r.Notes));
        }

        _audit.Add("export.production-records", "ProductionRecord", null,
            new { filter.From, filter.To, filter.PlantId, filter.LineId, filter.EquipmentId, rows = rows.Count });
        await _db.SaveChangesAsync(ct);

        if (rows.Count == MaxRows) Response.Headers["X-Export-Truncated"] = "true";

        var fileName = $"production-records_{filter.From!.Value:yyyy-MM-dd}_{filter.To!.Value:yyyy-MM-dd}.csv";
        return File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv", fileName);
    }
}
