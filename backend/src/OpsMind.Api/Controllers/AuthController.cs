using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OpsMind.Api.Auth;
using OpsMind.Api.Contracts;
using OpsMind.Api.Data;
using OpsMind.Api.Domain;
using OpsMind.Api.Services;

namespace OpsMind.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    // Verifying against a dummy hash for unknown emails keeps response time similar and avoids revealing which emails exist.
    private static readonly User DummyUser = new();
    private static readonly string DummyHash = new PasswordHasher<User>().HashPassword(DummyUser, "not-a-real-password-1");

    private readonly OpsMindDbContext _db;
    private readonly IPasswordHasher<User> _hasher;
    private readonly IJwtTokenService _tokens;
    private readonly JwtOptions _jwt;
    private readonly ICurrentUser _current;
    private readonly AuditService _audit;

    public AuthController(
        OpsMindDbContext db,
        IPasswordHasher<User> hasher,
        IJwtTokenService tokens,
        IOptions<JwtOptions> jwt,
        ICurrentUser current,
        AuditService audit)
    {
        _db = db;
        _hasher = hasher;
        _tokens = tokens;
        _jwt = jwt.Value;
        _current = current;
        _audit = audit;
    }

    [HttpPost("register")]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<UserDto>> Register(RegisterRequest request, CancellationToken ct)
    {
        var email = NormaliseEmail(request.Email);
        var organisationName = request.OrganisationName.Trim();

        if (await _db.Users.IgnoreQueryFilters().AnyAsync(u => u.Email == email, ct))
        {
            return Problem(statusCode: StatusCodes.Status409Conflict, title: "Email already registered",
                detail: "An account with this email address already exists.");
        }

        if (await _db.Organisations.IgnoreQueryFilters().AnyAsync(o => o.Name.ToLower() == organisationName.ToLower(), ct))
        {
            return Problem(statusCode: StatusCodes.Status409Conflict, title: "Organisation already exists",
                detail: "An organisation with this name already exists.");
        }

        var organisation = new Organisation { Id = Guid.NewGuid(), Name = organisationName };
        var user = new User
        {
            Id = Guid.NewGuid(),
            OrganisationId = organisation.Id,
            Email = email,
            FullName = request.FullName.Trim(),
            Role = UserRole.Admin
        };
        user.PasswordHash = _hasher.HashPassword(user, request.Password);

        _db.Organisations.Add(organisation);
        _db.Users.Add(user);
        _audit.AddFor(organisation.Id, user.Id, "user.register", nameof(User), user.Id, new { organisation = organisation.Name });
        await _db.SaveChangesAsync(ct);

        IssueSession(user);
        return UserDto.From(user, organisation.Name);
    }

    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    public async Task<ActionResult<UserDto>> Login(LoginRequest request, CancellationToken ct)
    {
        var email = NormaliseEmail(request.Email);
        var user = await _db.Users.IgnoreQueryFilters()
            .Include(u => u.Organisation)
            .FirstOrDefaultAsync(u => u.Email == email, ct);

        var verification = _hasher.VerifyHashedPassword(user ?? DummyUser, user?.PasswordHash ?? DummyHash, request.Password);

        if (user is null || !user.IsActive || verification == PasswordVerificationResult.Failed)
        {
            return Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Invalid credentials",
                detail: "The email address or password is incorrect.");
        }

        if (verification == PasswordVerificationResult.SuccessRehashNeeded)
        {
            user.PasswordHash = _hasher.HashPassword(user, request.Password);
        }

        _audit.AddFor(user.OrganisationId, user.Id, "auth.login", nameof(User), user.Id);
        await _db.SaveChangesAsync(ct);

        IssueSession(user);
        return UserDto.From(user, user.Organisation.Name);
    }

    [HttpPost("logout")]
    [AllowAnonymous]
    public IActionResult Logout()
    {
        Response.Cookies.Delete(_jwt.CookieName, CookieOptions(null));
        return NoContent();
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<UserDto>> Me(CancellationToken ct)
    {
        var user = await LoadCurrentUserAsync(ct);
        if (user is null) return Unauthorized();
        return UserDto.From(user, user.Organisation.Name);
    }

    [HttpPut("me")]
    [Authorize]
    public async Task<ActionResult<UserDto>> UpdateProfile(UpdateProfileRequest request, CancellationToken ct)
    {
        var user = await LoadCurrentUserAsync(ct);
        if (user is null) return Unauthorized();

        user.FullName = request.FullName.Trim();
        _audit.Add("user.update-profile", nameof(User), user.Id);
        await _db.SaveChangesAsync(ct);
        return UserDto.From(user, user.Organisation.Name);
    }

    [HttpPost("change-password")]
    [Authorize]
    [EnableRateLimiting("auth")]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest request, CancellationToken ct)
    {
        var user = await LoadCurrentUserAsync(ct);
        if (user is null) return Unauthorized();

        if (_hasher.VerifyHashedPassword(user, user.PasswordHash, request.CurrentPassword) == PasswordVerificationResult.Failed)
        {
            ModelState.AddModelError(nameof(request.CurrentPassword), "The current password is incorrect.");
            return ValidationProblem(ModelState);
        }

        if (request.CurrentPassword == request.NewPassword)
        {
            ModelState.AddModelError(nameof(request.NewPassword), "The new password must be different from the current one.");
            return ValidationProblem(ModelState);
        }

        user.PasswordHash = _hasher.HashPassword(user, request.NewPassword);
        _audit.Add("user.change-password", nameof(User), user.Id);
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    private async Task<User?> LoadCurrentUserAsync(CancellationToken ct)
    {
        if (_current.UserId is not { } userId) return null;
        var user = await _db.Users.Include(u => u.Organisation).FirstOrDefaultAsync(u => u.Id == userId, ct);
        return user is { IsActive: true } ? user : null;
    }

    private void IssueSession(User user)
    {
        var (token, expires) = _tokens.CreateToken(user);
        Response.Cookies.Append(_jwt.CookieName, token, CookieOptions(expires));
    }

    private CookieOptions CookieOptions(DateTime? expires) => new()
    {
        HttpOnly = true,
        Secure = _jwt.CookieSecure,
        SameSite = SameSiteMode.Strict,
        Path = "/",
        Expires = expires
    };

    private static string NormaliseEmail(string email) => email.Trim().ToLowerInvariant();
}
