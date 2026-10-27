using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OpsMind.Api.Auth;
using OpsMind.Api.Contracts;
using OpsMind.Api.Data;
using OpsMind.Api.Domain;
using OpsMind.Api.Services;

namespace OpsMind.Api.Controllers;

[Route("api/users")]
[Authorize(Policy = Policies.AdminOnly)]
public class UsersController : ApiControllerBase
{
    private readonly OpsMindDbContext _db;
    private readonly IPasswordHasher<User> _hasher;
    private readonly ICurrentUser _current;
    private readonly AuditService _audit;

    public UsersController(OpsMindDbContext db, IPasswordHasher<User> hasher, ICurrentUser current, AuditService audit)
    {
        _db = db;
        _hasher = hasher;
        _current = current;
        _audit = audit;
    }

    [HttpGet]
    public async Task<ActionResult<List<UserDto>>> List(CancellationToken ct)
    {
        var users = await _db.Users.AsNoTracking().Include(u => u.Organisation).OrderBy(u => u.FullName).ToListAsync(ct);
        return users.Select(u => UserDto.From(u, u.Organisation.Name)).ToList();
    }

    [HttpPost]
    public async Task<ActionResult<UserDto>> Create(CreateUserRequest request, CancellationToken ct)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        if (await _db.Users.IgnoreQueryFilters().AnyAsync(u => u.Email == email, ct))
        {
            return ConflictProblem("An account with this email address already exists.");
        }

        var organisationId = _current.OrganisationId!.Value;
        var user = new User
        {
            Id = Guid.NewGuid(),
            OrganisationId = organisationId,
            Email = email,
            FullName = request.FullName.Trim(),
            Role = request.Role
        };
        user.PasswordHash = _hasher.HashPassword(user, request.Password);

        _db.Users.Add(user);
        _audit.Add("user.create", nameof(User), user.Id, new { email, role = request.Role.ToString() });
        await _db.SaveChangesAsync(ct);

        var organisationName = await _db.Organisations.Select(o => o.Name).FirstAsync(ct);
        return StatusCode(StatusCodes.Status201Created, UserDto.From(user, organisationName));
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<UserDto>> Update(Guid id, UpdateUserRequest request, CancellationToken ct)
    {
        var user = await _db.Users.Include(u => u.Organisation).FirstOrDefaultAsync(u => u.Id == id, ct);
        if (user is null) return NotFound();

        if (id == _current.UserId && (request.Role != UserRole.Admin || !request.IsActive))
        {
            return FieldError("Role", "You cannot remove your own admin access or deactivate your own account.");
        }

        user.FullName = request.FullName.Trim();
        user.Role = request.Role;
        user.IsActive = request.IsActive;
        _audit.Add("user.update", nameof(User), user.Id, new { role = request.Role.ToString(), request.IsActive });
        await _db.SaveChangesAsync(ct);
        return UserDto.From(user, user.Organisation.Name);
    }
}
