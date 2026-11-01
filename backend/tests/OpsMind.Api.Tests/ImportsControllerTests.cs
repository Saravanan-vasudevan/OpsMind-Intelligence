using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.EntityFrameworkCore;
using OpsMind.Api.Auth;
using OpsMind.Api.Contracts;
using OpsMind.Api.Controllers;
using OpsMind.Api.Data;
using OpsMind.Api.Domain;
using OpsMind.Api.Infrastructure;
using OpsMind.Api.Services;

namespace OpsMind.Api.Tests;

/// <summary>Import history reads, on the EF Core in-memory provider (proves filters and paging logic, not PostgreSQL behaviour).</summary>
public class ImportsControllerTests
{
    private sealed class TestCurrentUser : ICurrentUser
    {
        public Guid? UserId { get; set; }
        public Guid? OrganisationId { get; set; }
        public string? Role => "Admin";
        public bool IsAuthenticated => OrganisationId.HasValue;
        public string? IpAddress => null;
    }

    private sealed class NoClient : IIntelligenceClient
    {
        public Task<IntelligenceResult> GetAsync(Guid organisationId, Guid? userId, string path, IEnumerable<KeyValuePair<string, string>> query, CancellationToken ct) =>
            throw new InvalidOperationException("not expected");
        public Task<IntelligenceResult> UploadAsync(Guid organisationId, Guid? userId, string path, Stream file, string fileName, IReadOnlyDictionary<string, string> fields, CancellationToken ct) =>
            throw new InvalidOperationException("not expected");
        public Task<bool> IsHealthyAsync(CancellationToken ct) => Task.FromResult(true);
    }

    private sealed class StubProblemFactory : ProblemDetailsFactory
    {
        public override ProblemDetails CreateProblemDetails(HttpContext httpContext, int? statusCode = null, string? title = null,
            string? type = null, string? detail = null, string? instance = null) => new() { Status = statusCode, Title = title, Detail = detail };

        public override ValidationProblemDetails CreateValidationProblemDetails(HttpContext httpContext, ModelStateDictionary modelStateDictionary,
            int? statusCode = null, string? title = null, string? type = null, string? detail = null, string? instance = null) =>
            new(modelStateDictionary) { Status = statusCode ?? 400, Title = title };
    }

    private static readonly Guid OrgA = Guid.NewGuid();
    private static readonly Guid OrgB = Guid.NewGuid();

    private static (ImportsController Controller, OpsMindDbContext Db, Guid BatchA, Guid BatchB) Create(Guid caller)
    {
        var name = Guid.NewGuid().ToString();
        var options = new DbContextOptionsBuilder<OpsMindDbContext>().UseInMemoryDatabase(name).Options;
        (Guid A, Guid B) ids;
        using (var seed = new OpsMindDbContext(options, new TestCurrentUser()))
        {
            var userA = new User { Id = Guid.NewGuid(), OrganisationId = OrgA, Email = "a@x", FullName = "Alice Admin", Role = UserRole.Admin };
            seed.Organisations.AddRange(new Organisation { Id = OrgA, Name = "A" }, new Organisation { Id = OrgB, Name = "B" });
            seed.Users.Add(userA);
            var a = Batch(OrgA, "a.csv", "production", "Completed", userA.Id, DateTime.UtcNow.AddHours(-2));
            var a2 = Batch(OrgA, "a2.csv", "downtime", "Rejected", null, DateTime.UtcNow.AddHours(-1));
            var b = Batch(OrgB, "b.csv", "production", "Completed", null, DateTime.UtcNow);
            seed.ImportBatches.AddRange(a, a2, b);
            seed.ImportErrors.AddRange(
                new ImportError { BatchId = a.Id, RowNumber = 5, ColumnName = "units_produced", Code = "negative", Message = "m" },
                new ImportError { BatchId = a.Id, RowNumber = 2, ColumnName = "run_minutes", Code = "required", Message = "m" },
                new ImportError { BatchId = b.Id, RowNumber = 1, Code = "x", Message = "other tenant" });
            seed.SaveChanges();
            ids = (a.Id, b.Id);
        }
        var current = new TestCurrentUser { OrganisationId = caller };
        var db = new OpsMindDbContext(options, current);
        var controller = new ImportsController(db, new NoClient(), current, new AuditService(db, current))
        {
            ProblemDetailsFactory = new StubProblemFactory()
        };
        return (controller, db, ids.A, ids.B);
    }

    private static ImportBatch Batch(Guid org, string file, string kind, string status, Guid? by, DateTime started) => new()
    {
        Id = Guid.NewGuid(), OrganisationId = org, Kind = kind, FileName = file, FileSha256 = new string('a', 64), SourceFormat = "csv",
        ConflictPolicy = "skip", Status = status, TotalRows = 10, InsertedRows = 8, RejectedRows = 2, CreatedBy = by, StartedAt = started
    };

    [Fact]
    public async Task List_returns_only_the_callers_batches_newest_first_with_the_uploader_name()
    {
        var (controller, db, _, _) = Create(OrgA);
        await using var scope = db;
        var page = (await controller.List(new ImportListQuery(), default)).Value!;
        Assert.Equal(2, page.TotalCount);
        Assert.Equal(new[] { "a2.csv", "a.csv" }, page.Items.Select(i => i.FileName));
        Assert.Equal("Alice Admin", page.Items[1].UploadedBy);
        Assert.Null(page.Items[0].UploadedBy);
        Assert.All(page.Items, i => Assert.Equal(DateTimeKind.Utc, i.StartedAt.Kind));
    }

    [Fact]
    public async Task List_filters_by_kind_and_status_and_rejects_unknown_values()
    {
        var (controller, db, _, _) = Create(OrgA);
        await using var scope = db;
        var onlyDowntime = (await controller.List(new ImportListQuery { Kind = "downtime" }, default)).Value!;
        Assert.Equal("a2.csv", Assert.Single(onlyDowntime.Items).FileName);
        Assert.Empty((await controller.List(new ImportListQuery { Status = "Failed" }, default)).Value!.Items);
        Assert.IsType<ObjectResult>((await controller.List(new ImportListQuery { Kind = "bogus" }, default)).Result);
    }

    [Fact]
    public async Task Errors_are_ordered_by_row_and_paged()
    {
        var (controller, db, batchA, _) = Create(OrgA);
        await using var scope = db;
        var page = (await controller.Errors(batchA, new ImportErrorQuery { PageSize = 1 }, default)).Value!;
        Assert.Equal(2, page.TotalCount);
        Assert.Equal(2, Assert.Single(page.Items).RowNumber);
    }

    [Fact]
    public async Task Another_organisations_batch_is_not_found()
    {
        var (controller, db, _, batchB) = Create(OrgA);
        await using var scope = db;
        Assert.IsType<NotFoundResult>((await controller.Errors(batchB, new ImportErrorQuery(), default)).Result);
    }
}
