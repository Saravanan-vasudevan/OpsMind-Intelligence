using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using OpsMind.Api.Auth;
using OpsMind.Api.Domain;

namespace OpsMind.Api.Tests;

public class JwtTokenServiceTests
{
    private const string Secret = "unit-test-secret-that-is-at-least-32-characters-long";

    private static JwtTokenService CreateService() =>
        new(Options.Create(new JwtOptions { Secret = Secret, Issuer = "issuer", Audience = "audience", ExpiryMinutes = 5 }));

    private static TokenValidationParameters Parameters(string secret) => new()
    {
        ValidIssuer = "issuer",
        ValidAudience = "audience",
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)),
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true
    };

    private static User CreateUser() => new()
    {
        Id = Guid.NewGuid(),
        OrganisationId = Guid.NewGuid(),
        Email = "user@example.com",
        Role = UserRole.Admin
    };

    [Fact]
    public async Task Token_carries_user_organisation_and_role_claims()
    {
        var user = CreateUser();
        var (token, _) = CreateService().CreateToken(user);

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, Parameters(Secret));

        Assert.True(result.IsValid);
        Assert.Equal(user.Id.ToString(), result.ClaimsIdentity.FindFirst("sub")?.Value);
        Assert.Equal(user.OrganisationId.ToString(), result.ClaimsIdentity.FindFirst("org")?.Value);
        Assert.Equal("Admin", result.ClaimsIdentity.FindFirst("role")?.Value);
    }

    [Fact]
    public async Task Token_signed_with_another_key_is_rejected()
    {
        var (token, _) = CreateService().CreateToken(CreateUser());

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, Parameters("a-completely-different-secret-of-32-chars-or-more"));

        Assert.False(result.IsValid);
    }

    [Fact]
    public void Expiry_follows_the_configured_lifetime()
    {
        var (_, expires) = CreateService().CreateToken(CreateUser());

        Assert.InRange(expires, DateTime.UtcNow.AddMinutes(4), DateTime.UtcNow.AddMinutes(6));
    }
}
