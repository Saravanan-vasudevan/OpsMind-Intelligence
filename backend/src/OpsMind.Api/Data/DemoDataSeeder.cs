using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using OpsMind.Api.Domain;

namespace OpsMind.Api.Data;

/// <summary>
/// Creates a clearly synthetic demonstration organisation. It is deterministic (fixed random seed) and
/// idempotent (skipped if the organisation already exists). It only runs when Seed:DemoData=true.
/// The generated figures are invented and do not represent any real company.
/// </summary>
public static class DemoDataSeeder
{
    public const string OrganisationName = "Demo Manufacturing Ltd (synthetic data)";
    public const string AdminEmail = "demo.admin@opsmind.example";
    public const string UserEmail = "demo.user@opsmind.example";
    public const string DemoPassword = "Demo-Passw0rd!";
    private const int DaysOfHistory = 60;

    private sealed record CategorySpec(string Name, decimal IdealRate, double RejectRate);

    private static readonly CategorySpec[] Categories =
    {
        new("CNC Machine", 55m, 0.018),
        new("Injection Moulder", 120m, 0.024),
        new("Packaging Line", 200m, 0.012),
        new("Hydraulic Press", 90m, 0.020)
    };

    private static readonly string[] UnplannedReasons = { "MECH_FAIL", "ELEC_FAULT", "MATERIAL_SHORT", "JAM", "SENSOR", "OPERATOR" };

    public static async Task SeedAsync(OpsMindDbContext db, IPasswordHasher<User> hasher, ILogger logger, CancellationToken ct)
    {
        if (await db.Organisations.IgnoreQueryFilters().AnyAsync(o => o.Name == OrganisationName, ct))
        {
            logger.LogInformation("Demo data already present; skipping seed");
            return;
        }

        var random = new Random(42);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var firstDay = today.AddDays(-DaysOfHistory);

        var organisation = new Organisation { Id = Guid.NewGuid(), Name = OrganisationName };
        db.Organisations.Add(organisation);

        var admin = new User { Id = Guid.NewGuid(), OrganisationId = organisation.Id, Email = AdminEmail, FullName = "Demo Admin", Role = UserRole.Admin };
        admin.PasswordHash = hasher.HashPassword(admin, DemoPassword);
        var standard = new User { Id = Guid.NewGuid(), OrganisationId = organisation.Id, Email = UserEmail, FullName = "Demo Operator", Role = UserRole.User };
        standard.PasswordHash = hasher.HashPassword(standard, DemoPassword);
        db.Users.AddRange(admin, standard);

        var categories = Categories.ToDictionary(
            c => c.Name,
            c => new EquipmentCategory { Id = Guid.NewGuid(), OrganisationId = organisation.Id, Name = c.Name });
        db.EquipmentCategories.AddRange(categories.Values);

        var plantSpecs = new[]
        {
            (Name: "North Plant", Code: "NORTH", Location: "Synthetic location A"),
            (Name: "South Plant", Code: "SOUTH", Location: "Synthetic location B"),
            (Name: "East Plant", Code: "EAST", Location: "Synthetic location C")
        };

        var machines = new List<(Equipment Machine, Plant Plant, CategorySpec Spec, bool Degrading)>();
        var shiftsByPlant = new Dictionary<Guid, List<Shift>>();

        foreach (var spec in plantSpecs)
        {
            var plant = new Plant
            {
                Id = Guid.NewGuid(), OrganisationId = organisation.Id, Name = spec.Name, Code = spec.Code, Location = spec.Location, TimeZone = "UTC"
            };
            db.Plants.Add(plant);

            var shifts = new List<Shift>
            {
                new() { Id = Guid.NewGuid(), PlantId = plant.Id, Name = "Early", StartTime = new TimeOnly(6, 0), EndTime = new TimeOnly(14, 0) },
                new() { Id = Guid.NewGuid(), PlantId = plant.Id, Name = "Late", StartTime = new TimeOnly(14, 0), EndTime = new TimeOnly(22, 0) },
                new() { Id = Guid.NewGuid(), PlantId = plant.Id, Name = "Night", StartTime = new TimeOnly(22, 0), EndTime = new TimeOnly(6, 0) }
            };
            db.Shifts.AddRange(shifts);
            shiftsByPlant[plant.Id] = shifts;

            for (var lineNumber = 1; lineNumber <= 2; lineNumber++)
            {
                var line = new ProductionLine { Id = Guid.NewGuid(), PlantId = plant.Id, Name = $"Line {lineNumber}", Code = $"L{lineNumber}" };
                db.ProductionLines.Add(line);

                for (var m = 1; m <= 4; m++)
                {
                    var categorySpec = Categories[(m - 1) % Categories.Length];
                    var machine = new Equipment
                    {
                        Id = Guid.NewGuid(),
                        ProductionLineId = line.Id,
                        CategoryId = categories[categorySpec.Name].Id,
                        AssetCode = $"{spec.Code[0]}{lineNumber}-M{m:00}",
                        Name = $"{categorySpec.Name} {spec.Code[0]}{lineNumber}-{m}",
                        IdealRatePerHour = categorySpec.IdealRate,
                        CommissionedOn = firstDay.AddYears(-3),
                        Status = EquipmentStatus.Active
                    };
                    db.EquipmentItems.Add(machine);
                    // One machine in the South plant shows rising failures in the last three weeks.
                    var degrading = spec.Code == "SOUTH" && lineNumber == 1 && m == 2;
                    machines.Add((machine, plant, categorySpec, degrading));
                }
            }
        }

        foreach (var (machine, plant, categorySpec, degrading) in machines)
        {
            var downtimeStarts = new List<(DateTime Start, DateTime End)>();

            for (var day = firstDay; day < today; day = day.AddDays(1))
            {
                var weekend = day.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;
                var daysAgo = today.DayNumber - day.DayNumber;

                // Demand dip in the East plant five to six weeks ago.
                var demandFactor = plant.Code == "EAST" && daysAgo is >= 35 and <= 42 ? 0.8 : 1.0;
                // Rejects rise in the North plant over the last two weeks.
                var rejectBoost = plant.Code == "NORTH" && daysAgo <= 14 ? 1.8 : 1.0;

                foreach (var shift in shiftsByPlant[plant.Id])
                {
                    if (weekend && shift.Name != "Early") continue;
                    if (shift.Name == "Night" && machine.AssetCode.EndsWith("M03", StringComparison.Ordinal)) continue;

                    // Every demo shift is 8 hours; the database computes the stored duration on insert.
                    const int shiftMinutes = 480;
                    var shiftStart = day.ToDateTime(shift.StartTime, DateTimeKind.Utc);
                    var downtimeInShift = 0.0;

                    // Planned maintenance: Wednesday, first hour of the early shift.
                    if (day.DayOfWeek == DayOfWeek.Wednesday && shift.Name == "Early")
                    {
                        AddDowntime(db, machine, shiftStart, shiftStart.AddMinutes(60), DowntimeCategory.Planned, "PLANNED_MAINT", downtimeStarts);
                        downtimeInShift += 60;
                    }

                    var failureChance = degrading && daysAgo <= 21 ? 0.16 : 0.035;
                    if (random.NextDouble() < failureChance)
                    {
                        var duration = random.Next(15, 181);
                        var offset = random.Next(61, Math.Max(62, shiftMinutes - duration));
                        var start = shiftStart.AddMinutes(offset);
                        var end = start.AddMinutes(duration);
                        var reason = degrading && daysAgo <= 21 ? "MECH_FAIL" : UnplannedReasons[random.Next(UnplannedReasons.Length)];
                        if (AddDowntime(db, machine, start, end, DowntimeCategory.Unplanned, reason, downtimeStarts))
                        {
                            downtimeInShift += duration;
                        }
                    }

                    var changeover = random.Next(10, 31);
                    var runMinutes = (int)Math.Max(0, shiftMinutes - downtimeInShift - changeover);
                    var efficiency = 0.82 + random.NextDouble() * 0.15;
                    var rate = (double)(machine.IdealRatePerHour ?? 0m);
                    var units = (int)Math.Round(rate * runMinutes / 60.0 * efficiency * demandFactor);
                    // The target stays at the planned level, so a demand dip shows up as lower attainment.
                    var target = (int)Math.Round(rate * shiftMinutes / 60.0 * 0.9);

                    var record = new ProductionRecord
                    {
                        Id = Guid.NewGuid(),
                        EquipmentId = machine.Id,
                        ShiftId = shift.Id,
                        ShiftDate = day,
                        UnitsProduced = units,
                        TargetUnits = target,
                        RunMinutes = runMinutes,
                        CreatedBy = admin.Id
                    };

                    var rejectRate = Math.Min(0.25, categorySpec.RejectRate * rejectBoost * (0.7 + random.NextDouble() * 0.6));
                    var rejected = (int)Math.Round(units * rejectRate);
                    record.Quality = new QualityRecord
                    {
                        Id = Guid.NewGuid(),
                        InspectedUnits = units,
                        RejectedUnits = Math.Min(rejected, units),
                        DefectType = rejected > 0 ? (random.NextDouble() < 0.5 ? "DIMENSION" : "SURFACE") : null
                    };
                    db.ProductionRecords.Add(record);
                }
            }
        }

        await db.SaveChangesAsync(ct);
        logger.LogInformation("Seeded synthetic demo organisation with {Machines} machines over {Days} days", machines.Count, DaysOfHistory);
    }

    private static bool AddDowntime(
        OpsMindDbContext db,
        Equipment machine,
        DateTime start,
        DateTime end,
        DowntimeCategory category,
        string reason,
        List<(DateTime Start, DateTime End)> existing)
    {
        if (existing.Any(e => e.Start < end && e.End > start)) return false;

        existing.Add((start, end));
        db.DowntimeEvents.Add(new DowntimeEvent
        {
            Id = Guid.NewGuid(),
            EquipmentId = machine.Id,
            StartTime = start,
            EndTime = end,
            Category = category,
            ReasonCode = reason
        });
        return true;
    }
}
