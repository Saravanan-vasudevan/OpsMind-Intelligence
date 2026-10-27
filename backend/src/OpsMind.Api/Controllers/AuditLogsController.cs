using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OpsMind.Api.Auth;
using OpsMind.Api.Contracts;
using OpsMind.Api.Data;

namespace OpsMind.Api.Controllers;

[Route("api/audit-logs")]
[Authorize(Policy = Policies.AdminOnly)]
public class AuditLogsController : ApiControllerBase
{
    private readonly OpsMindDbContext _db;

    public AuditLogsController(OpsMindDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<ActionResult<PagedResult<AuditLogDto>>> List(
        [FromQuery] string? action, [FromQuery] int? page, [FromQuery] int? pageSize, CancellationToken ct)
    {
        var (pageNumber, size) = Paging.Normalise(page, pageSize, 100);

        var logs = _db.AuditLogs.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(action))
        {
            var prefix = action.Trim();
            logs = logs.Where(a => a.Action.StartsWith(prefix));
        }

        var total = await logs.CountAsync(ct);

        var query =
            from a in logs
            join u in _db.Users on a.UserId equals u.Id into users
            from user in users.DefaultIfEmpty()
            orderby a.CreatedAt descending, a.Id descending
            select new AuditLogDto(a.Id, a.CreatedAt, a.UserId, user == null ? null : user.FullName,
                a.Action, a.Entity, a.EntityId, a.Details, a.IpAddress);

        var items = await query.Skip((pageNumber - 1) * size).Take(size).ToListAsync(ct);
        return new PagedResult<AuditLogDto>(items, pageNumber, size, total);
    }
}
