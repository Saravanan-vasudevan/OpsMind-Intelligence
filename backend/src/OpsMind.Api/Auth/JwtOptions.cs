namespace OpsMind.Api.Auth;

public class JwtOptions
{
    public const string Section = "Jwt";

    public string Secret { get; set; } = string.Empty;
    public string Issuer { get; set; } = "opsmind";
    public string Audience { get; set; } = "opsmind";
    public int ExpiryMinutes { get; set; } = 60;
    public string CookieName { get; set; } = "opsmind_session";

    /// <summary>Set to false only for local HTTP development.</summary>
    public bool CookieSecure { get; set; } = true;
}

public static class Policies
{
    public const string AdminOnly = "AdminOnly";
}
