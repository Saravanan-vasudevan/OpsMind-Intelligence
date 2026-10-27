using Microsoft.EntityFrameworkCore;
using OpsMind.Api.Auth;
using OpsMind.Api.Data;
using OpsMind.Api.Domain;

namespace OpsMind.Api.Tests;

/// <summary>
/// Checks the global query filters. These run on the EF Core in-memory provider, so they prove the filter
/// logic (including filters through parent navigations) but not the generated PostgreSQL SQL.
/// </summary>
public class TenantIsolationTests
{
    private sealed class TestCurrentUser : ICurrentUser
    {
        public Guid? UserId { get; set; }
        public Guid? OrganisationId { get; set; }
        public string? Role { get; set; }
        public bool IsAuthenticated => OrganisationId.HasValue;
        public string? IpAddress => null;
    }

    private sealed record Seeded(string DatabaseName, Guid OrgA, Guid OrgB, Guid EquipmentA, Guid EquipmentB);

    private static OpsMindDbContext CreateContext(string databaseName, Guid? organisationId)
    {
        var options = new DbContextOptionsBuilder<OpsMindDbContext>().UseInMemoryDatabase(databaseName).Options;
        return new OpsMindDbContext(options, new TestCurrentUser { OrganisationId = organisationId });
    }

    private static async Task<Seeded> SeedTwoOrganisationsAsync()
    {
        var databaseName = Guid.NewGuid().ToString();
        var orgA = Guid.NewGuid();
        var orgB = Guid.NewGuid();
        var equipmentIds = new Dictionary<Guid, Guid>();

        await using var db = CreateContext(databaseName, null);

        foreach (var (orgId, label, units) in new[] { (orgA, "A", 100), (orgB, "B", 200) })
        {
            var plant = new Plant { Id = Guid.NewGuid(), OrganisationId = orgId, Name = $"Plant {label}", Code = $"P{label}" };
            var line = new ProductionLine { Id = Guid.NewGuid(), PlantId = plant.Id, Name = "Line", Code = "L1" };
            var category = new EquipmentCategory { Id = Guid.NewGuid(), OrganisationId = orgId, Name = "Press" };
            var equipment = new Equipment { Id = Guid.NewGuid(), ProductionLineId = line.Id, CategoryId = category.Id, AssetCode = $"M-{label}", Name = $"Machine {label}" };
            var shift = new Shift { Id = Guid.NewGuid(), PlantId = plant.Id, Name = "Day", StartTime = new TimeOnly(6, 0), EndTime = new TimeOnly(14, 0) };
            var record = new ProductionRecord
            {
                Id = Guid.NewGuid(), EquipmentId = equipment.Id, ShiftId = shift.Id, ShiftDate = new DateOnly(2026, 1, 5),
                UnitsProduced = units, TargetUnits = 250, RunMinutes = 400
            };

            db.Organisations.Add(new Organisation { Id = orgId, Name = $"Org {label}" });
            db.Plants.Add(plant);
            db.ProductionLines.Add(line);
            db.EquipmentCategories.Add(category);
            db.EquipmentItems.Add(equipment);
            db.Shifts.Add(shift);
            db.ProductionRecords.Add(record);
            equipmentIds[orgId] = equipment.Id;
        }

        await db.SaveChangesAsync();
        return new Seeded(databaseName, orgA, orgB, equipmentIds[orgA], equipmentIds[orgB]);
    }

    [Fact]
    public async Task Plants_are_limited_to_the_callers_organisation()
    {
        var seeded = await SeedTwoOrganisationsAsync();
        await using var db = CreateContext(seeded.DatabaseName, seeded.OrgA);

        var plants = await db.Plants.ToListAsync();

        Assert.Single(plants);
        Assert.Equal("Plant A", plants[0].Name);
    }

    [Fact]
    public async Task Production_records_are_filtered_through_the_equipment_line_plant_chain()
    {
        var seeded = await SeedTwoOrganisationsAsync();
        await using var db = CreateContext(seeded.DatabaseName, seeded.OrgB);

        var records = await db.ProductionRecords.ToListAsync();

        Assert.Single(records);
        Assert.Equal(200, records[0].UnitsProduced);
    }

    [Fact]
    public async Task Another_organisations_equipment_cannot_be_loaded_by_id()
    {
        var seeded = await SeedTwoOrganisationsAsync();
        await using var db = CreateContext(seeded.DatabaseName, seeded.OrgA);

        var foreign = await db.EquipmentItems.FirstOrDefaultAsync(e => e.Id == seeded.EquipmentB);
        var own = await db.EquipmentItems.FirstOrDefaultAsync(e => e.Id == seeded.EquipmentA);

        Assert.Null(foreign);
        Assert.NotNull(own);
    }

    [Fact]
    public async Task Unauthenticated_context_sees_no_tenant_data()
    {
        var seeded = await SeedTwoOrganisationsAsync();
        await using var db = CreateContext(seeded.DatabaseName, null);

        Assert.Empty(await db.Plants.ToListAsync());
        Assert.Empty(await db.ProductionRecords.ToListAsync());
        Assert.Empty(await db.Organisations.ToListAsync());
    }

    [Fact]
    public async Task IgnoreQueryFilters_is_the_explicit_way_to_cross_tenants()
    {
        var seeded = await SeedTwoOrganisationsAsync();
        await using var db = CreateContext(seeded.DatabaseName, seeded.OrgA);

        Assert.Equal(2, await db.Plants.IgnoreQueryFilters().CountAsync());
    }
}
