using System.Text.Json;
using OpsMind.Api.Auth;
using OpsMind.Api.Data;
using OpsMind.Api.Domain;

namespace OpsMind.Api.Services;

/// <summary>Adds an audit row to the current unit of work, so it is saved (or rolled back) together with the change itself.</summary>
public class AuditService
{
    private readonly OpsMindDbContext _db;
    private readonly ICurrentUser _currentUser;

    public AuditService(OpsMindDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public void Add(string action, string entity, object? entityId = null, object? details = null)
    {
        var organisationId = _currentUser.OrganisationId
            ?? throw new InvalidOperationException("Audit entries require an authenticated organisation.");
        AddFor(organisationId, _currentUser.UserId, action, entity, entityId, details);
    }

    public void AddFor(Guid organisationId, Guid? userId, string action, string entity, object? entityId = null, object? details = null)
    {
        _db.AuditLogs.Add(new AuditLog
        {
            OrganisationId = organisationId,
            UserId = userId,
            Action = action,
            Entity = entity,
            EntityId = entityId?.ToString(),
            Details = details is null ? null : JsonSerializer.Serialize(details),
            IpAddress = _currentUser.IpAddress
        });
    }
}
