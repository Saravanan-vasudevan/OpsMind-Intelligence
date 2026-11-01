using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OpsMind.Api.Auth;
using OpsMind.Api.Contracts;
using OpsMind.Api.Data;
using OpsMind.Api.Infrastructure;
using OpsMind.Api.Services;

namespace OpsMind.Api.Controllers;

/// <summary>
/// CSV/Excel uploads. The file is validated and loaded by the Python ETL service in one transaction per batch; this controller only
/// authorises the caller (Admin), forwards the file with the caller's organisation, audits the upload and serves the import history.
/// </summary>
[Route("api/imports")]
public class ImportsController : ApiControllerBase
{
    public const long MaxRequestBytes = 11 * 1024 * 1024;   // the service's own limit is 10 MB for the file itself

    private static readonly string[] Kinds = { "production", "downtime" };
    private static readonly string[] ConflictPolicies = { "skip", "update" };
    private static readonly string[] Statuses = { "Completed", "Rejected", "Failed" };

    private readonly OpsMindDbContext _db;
    private readonly IIntelligenceClient _client;
    private readonly ICurrentUser _current;
    private readonly AuditService _audit;

    public ImportsController(OpsMindDbContext db, IIntelligenceClient client, ICurrentUser current, AuditService audit)
    {
        _db = db;
        _client = client;
        _current = current;
        _audit = audit;
    }

    [HttpPost]
    [Authorize(Policy = Policies.AdminOnly)]
    [RequestSizeLimit(MaxRequestBytes)]
    public async Task<IActionResult> Upload([FromForm] ImportUploadRequest request, CancellationToken ct)
    {
        var kind = request.Kind?.Trim().ToLowerInvariant();
        var policy = (request.ConflictPolicy ?? "skip").Trim().ToLowerInvariant();
        if (request.File is null || request.File.Length == 0) return FieldError(nameof(request.File), "Choose a non-empty .csv or .xlsx file.");
        if (kind is null || !Kinds.Contains(kind)) return FieldError(nameof(request.Kind), "Kind must be production or downtime.");
        if (!ConflictPolicies.Contains(policy)) return FieldError(nameof(request.ConflictPolicy), "Conflict policy must be skip or update.");

        await using var stream = request.File.OpenReadStream();
        var result = await _client.UploadAsync(_current.OrganisationId!.Value, _current.UserId, "/imports", stream,
            Path.GetFileName(request.File.FileName),
            new Dictionary<string, string>
            {
                ["kind"] = kind,
                ["conflict_policy"] = policy,
                ["strict"] = request.Strict ? "true" : "false"
            }, ct);

        if (result.StatusCode == 200) await AuditUploadAsync(result, kind, ct);

        return new ContentResult
        {
            StatusCode = result.StatusCode,
            ContentType = result.ContentType,
            Content = System.Text.Encoding.UTF8.GetString(result.Body)
        };
    }

    [HttpGet]
    public async Task<ActionResult<PagedResult<ImportBatchDto>>> List([FromQuery] ImportListQuery query, CancellationToken ct)
    {
        if (query.Kind is not null && !Kinds.Contains(query.Kind)) return FieldError(nameof(query.Kind), "Kind must be production or downtime.");
        if (query.Status is not null && !Statuses.Contains(query.Status)) return FieldError(nameof(query.Status), "Status must be Completed, Rejected or Failed.");

        var (page, pageSize) = Paging.Normalise(query.Page, query.PageSize);
        var batches = _db.ImportBatches.AsNoTracking().AsQueryable();
        if (query.Kind is not null) batches = batches.Where(b => b.Kind == query.Kind);
        if (query.Status is not null) batches = batches.Where(b => b.Status == query.Status);

        var total = await batches.CountAsync(ct);
        var rows = await batches.OrderByDescending(b => b.StartedAt).ThenBy(b => b.Id)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);

        var userIds = rows.Where(b => b.CreatedBy != null).Select(b => b.CreatedBy!.Value).Distinct().ToList();
        var names = await _db.Users.AsNoTracking().Where(u => userIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.FullName, ct);

        var items = rows.Select(b => new ImportBatchDto(
            b.Id, b.Kind, b.FileName, b.SourceFormat, b.ConflictPolicy, b.Strict, b.Status, b.TotalRows, b.InsertedRows,
            b.UpdatedRows, b.SkippedRows, b.RejectedRows, b.ErrorsTruncated, b.Message,
            b.CreatedBy is { } id && names.TryGetValue(id, out var name) ? name : null,
            DateTime.SpecifyKind(b.StartedAt, DateTimeKind.Utc),
            b.CompletedAt is { } done ? DateTime.SpecifyKind(done, DateTimeKind.Utc) : null)).ToList();

        return new PagedResult<ImportBatchDto>(items, page, pageSize, total);
    }

    [HttpGet("{id:guid}/errors")]
    public async Task<ActionResult<PagedResult<ImportErrorDto>>> Errors(Guid id, [FromQuery] ImportErrorQuery query, CancellationToken ct)
    {
        // The tenant filter applies here, so another organisation's batch is simply "not found".
        if (!await _db.ImportBatches.AnyAsync(b => b.Id == id, ct)) return NotFound();

        var (page, pageSize) = Paging.Normalise(query.Page, query.PageSize, 500);
        var errors = _db.ImportErrors.AsNoTracking().Where(e => e.BatchId == id);
        var total = await errors.CountAsync(ct);
        var items = await errors.OrderBy(e => e.RowNumber).ThenBy(e => e.ColumnName).ThenBy(e => e.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(e => new ImportErrorDto(e.RowNumber, e.ColumnName, e.Code, e.Message, e.RawValue))
            .ToListAsync(ct);
        return new PagedResult<ImportErrorDto>(items, page, pageSize, total);
    }

    private async Task AuditUploadAsync(IntelligenceResult result, string kind, CancellationToken ct)
    {
        try
        {
            using var doc = JsonDocument.Parse(result.Body);
            var root = doc.RootElement;
            Guid? batchId = root.TryGetProperty("batchId", out var b) && Guid.TryParse(b.GetString(), out var parsed) ? parsed : null;
            _audit.Add("import.upload", "ImportBatch", batchId, new
            {
                kind,
                fileName = root.TryGetProperty("fileName", out var f) ? f.GetString() : null,
                status = root.TryGetProperty("status", out var s) ? s.GetString() : null,
                inserted = root.TryGetProperty("insertedRows", out var i) ? i.GetInt32() : (int?)null,
                updated = root.TryGetProperty("updatedRows", out var u) ? u.GetInt32() : (int?)null,
                rejected = root.TryGetProperty("rejectedRows", out var r) ? r.GetInt32() : (int?)null,
                alreadyImported = root.TryGetProperty("alreadyImported", out var a) && a.GetBoolean()
            });
            await _db.SaveChangesAsync(ct);
        }
        catch (JsonException)
        {
            // The import itself already happened and is in the import history; a malformed summary must not turn it into an error.
        }
    }
}
