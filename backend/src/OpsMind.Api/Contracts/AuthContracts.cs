using System.ComponentModel.DataAnnotations;
using OpsMind.Api.Domain;

namespace OpsMind.Api.Contracts;

public static class PasswordRules
{
    public const string Pattern = @"^(?=.*[A-Za-z])(?=.*\d).+$";
    public const string Message = "Password must be 10 to 100 characters and contain at least one letter and one number.";
}

public class RegisterRequest
{
    [Required, StringLength(120, MinimumLength = 2)]
    public string OrganisationName { get; set; } = string.Empty;

    [Required, StringLength(120, MinimumLength = 2)]
    public string FullName { get; set; } = string.Empty;

    [Required, EmailAddress, StringLength(254)]
    public string Email { get; set; } = string.Empty;

    [Required, StringLength(100, MinimumLength = 10), RegularExpression(PasswordRules.Pattern, ErrorMessage = PasswordRules.Message)]
    public string Password { get; set; } = string.Empty;
}

public class LoginRequest
{
    [Required, EmailAddress, StringLength(254)]
    public string Email { get; set; } = string.Empty;

    [Required, StringLength(100)]
    public string Password { get; set; } = string.Empty;
}

public class ChangePasswordRequest
{
    [Required, StringLength(100)]
    public string CurrentPassword { get; set; } = string.Empty;

    [Required, StringLength(100, MinimumLength = 10), RegularExpression(PasswordRules.Pattern, ErrorMessage = PasswordRules.Message)]
    public string NewPassword { get; set; } = string.Empty;
}

public class UpdateProfileRequest
{
    [Required, StringLength(120, MinimumLength = 2)]
    public string FullName { get; set; } = string.Empty;
}

public class CreateUserRequest
{
    [Required, StringLength(120, MinimumLength = 2)]
    public string FullName { get; set; } = string.Empty;

    [Required, EmailAddress, StringLength(254)]
    public string Email { get; set; } = string.Empty;

    [Required, StringLength(100, MinimumLength = 10), RegularExpression(PasswordRules.Pattern, ErrorMessage = PasswordRules.Message)]
    public string Password { get; set; } = string.Empty;

    public UserRole Role { get; set; } = UserRole.User;
}

public class UpdateUserRequest
{
    [Required, StringLength(120, MinimumLength = 2)]
    public string FullName { get; set; } = string.Empty;

    public UserRole Role { get; set; }
    public bool IsActive { get; set; }
}

public record UserDto(
    Guid Id,
    string Email,
    string FullName,
    UserRole Role,
    bool IsActive,
    Guid OrganisationId,
    string OrganisationName,
    DateTime CreatedAt)
{
    public static UserDto From(User user, string organisationName) =>
        new(user.Id, user.Email, user.FullName, user.Role, user.IsActive, user.OrganisationId, organisationName, user.CreatedAt);
}
