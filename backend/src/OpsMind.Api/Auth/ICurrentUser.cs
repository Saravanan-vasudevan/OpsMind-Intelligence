namespace OpsMind.Api.Auth;

public interface ICurrentUser
{
    Guid? UserId { get; }
    Guid? OrganisationId { get; }
    string? Role { get; }
    bool IsAuthenticated { get; }
    string? IpAddress { get; }
}

/// <summary>Reads the identity from the validated JWT claims: sub, org, role.</summary>
public class HttpCurrentUser : ICurrentUser
{
    private readonly IHttpContextAccessor _accessor;

    public HttpCurrentUser(IHttpContextAccessor accessor)
    {
        _accessor = accessor;
    }

    private System.Security.Claims.ClaimsPrincipal? Principal => _accessor.HttpContext?.User;

    public Guid? UserId => ParseGuid("sub");
    public Guid? OrganisationId => ParseGuid("org");
    public string? Role => Principal?.FindFirst("role")?.Value;
    public bool IsAuthenticated => Principal?.Identity?.IsAuthenticated == true;
    public string? IpAddress => _accessor.HttpContext?.Connection.RemoteIpAddress?.ToString();

    private Guid? ParseGuid(string claimType)
    {
        var value = Principal?.FindFirst(claimType)?.Value;
        return Guid.TryParse(value, out var id) ? id : null;
    }
}
