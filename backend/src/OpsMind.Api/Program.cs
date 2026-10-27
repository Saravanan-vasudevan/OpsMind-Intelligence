using System.Text;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using OpsMind.Api.Auth;
using Swashbuckle.AspNetCore.SwaggerUI;
using OpsMind.Api.Data;
using OpsMind.Api.Domain;
using OpsMind.Api.Infrastructure;
using OpsMind.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole();

var jwtOptions = builder.Configuration.GetSection(JwtOptions.Section).Get<JwtOptions>() ?? new JwtOptions();
if (string.IsNullOrWhiteSpace(jwtOptions.Secret) || jwtOptions.Secret.Length < 32)
{
    throw new InvalidOperationException("Jwt:Secret must be set to at least 32 characters (environment variable Jwt__Secret).");
}

var connectionString = builder.Configuration.GetConnectionString("Default");
if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException("ConnectionStrings:Default is not set (environment variable ConnectionStrings__Default).");
}

builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection(JwtOptions.Section));
builder.Services.AddDbContext<OpsMindDbContext>(options => options.UseNpgsql(connectionString));
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, HttpCurrentUser>();
builder.Services.AddScoped<IPasswordHasher<User>, PasswordHasher<User>>();
builder.Services.AddSingleton<IJwtTokenService, JwtTokenService>();
builder.Services.AddScoped<AuditService>();
builder.Services.AddScoped<AnalyticsService>();

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtOptions.Issuer,
            ValidateAudience = true,
            ValidAudience = jwtOptions.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtOptions.Secret)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(30),
            NameClaimType = "sub",
            RoleClaimType = "role"
        };
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                if (context.Request.Cookies.TryGetValue(jwtOptions.CookieName, out var token))
                {
                    context.Token = token;
                }
                return Task.CompletedTask;
            },
            // Reject tokens of deactivated users or users whose role changed since the token was issued.
            OnTokenValidated = async context =>
            {
                var subject = context.Principal?.FindFirst("sub")?.Value;
                var roleClaim = context.Principal?.FindFirst("role")?.Value;
                if (!Guid.TryParse(subject, out var userId))
                {
                    context.Fail("Invalid subject.");
                    return;
                }

                var db = context.HttpContext.RequestServices.GetRequiredService<OpsMindDbContext>();
                var current = await db.Users.IgnoreQueryFilters()
                    .Where(u => u.Id == userId)
                    .Select(u => new { u.IsActive, u.Role })
                    .FirstOrDefaultAsync(context.HttpContext.RequestAborted);

                if (current is null || !current.IsActive || current.Role.ToString() != roleClaim)
                {
                    context.Fail("User is inactive, removed, or has a changed role.");
                }
            }
        };
    });

builder.Services.AddAuthorization(options =>
    options.AddPolicy(Policies.AdminOnly, policy => policy.RequireRole(UserRole.Admin.ToString())));

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("auth", httpContext => RateLimitPartition.GetFixedWindowLimiter(
        httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));
});

builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    // The API sits behind a reverse proxy inside the container network; restrict this in other topologies.
    options.KnownNetworks.Clear();
    options.KnownProxies.Clear();
});

builder.Services.AddControllers()
    .AddJsonOptions(options => options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddOpenApi();
builder.Services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("database", tags: new[] { "ready" });

var app = builder.Build();

app.UseForwardedHeaders();
app.UseMiddleware<ExceptionHandlingMiddleware>();

if (builder.Configuration.GetValue("Database:MigrateOnStartup", true))
{
    await MigrationRunner.ApplyAsync(connectionString, app.Logger, CancellationToken.None);
}

if (builder.Configuration.GetValue("Seed:DemoData", false))
{
    using var scope = app.Services.CreateScope();
    await DemoDataSeeder.SeedAsync(
        scope.ServiceProvider.GetRequiredService<OpsMindDbContext>(),
        scope.ServiceProvider.GetRequiredService<IPasswordHasher<User>>(),
        app.Logger,
        CancellationToken.None);
}

if (app.Environment.IsDevelopment() || builder.Configuration.GetValue("Swagger:Enabled", false))
{
    app.MapOpenApi();
    app.UseSwaggerUI(options =>
    {
        options.RoutePrefix = "swagger";
        options.SwaggerEndpoint("/openapi/v1.json", "OpsMind API v1");
        options.UseRequestInterceptor("(req) => { req.headers['X-Requested-With'] = 'OpsMind'; return req; }");
    });
}

app.UseRateLimiter();
app.UseAuthentication();
app.UseMiddleware<CsrfProtectionMiddleware>();
app.UseAuthorization();

app.MapControllers();
app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = _ => false });
app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = check => check.Tags.Contains("ready") });

app.Run();

public partial class Program { }
