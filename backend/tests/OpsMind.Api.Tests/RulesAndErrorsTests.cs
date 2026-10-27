using OpsMind.Api.Contracts;
using OpsMind.Api.Domain;
using OpsMind.Api.Infrastructure;
using OpsMind.Api.Services;

namespace OpsMind.Api.Tests;

public class ProductionRecordRulesTests
{
    [Fact]
    public void Run_minutes_cannot_exceed_shift_length()
    {
        var errors = ProductionRecordRules.ValidateValues(500, null, null, 480).ToList();

        Assert.Contains(errors, e => e.Field == "RunMinutes");
    }

    [Fact]
    public void Inspected_and_rejected_must_be_given_together()
    {
        var errors = ProductionRecordRules.ValidateValues(400, 100, null, 480).ToList();

        Assert.Contains(errors, e => e.Field == "InspectedUnits");
    }

    [Fact]
    public void Rejected_cannot_exceed_inspected()
    {
        var errors = ProductionRecordRules.ValidateValues(400, 10, 11, 480).ToList();

        Assert.Contains(errors, e => e.Field == "RejectedUnits");
    }

    [Fact]
    public void Valid_values_produce_no_errors()
    {
        Assert.Empty(ProductionRecordRules.ValidateValues(400, 100, 3, 480));
        Assert.Empty(ProductionRecordRules.ValidateValues(400, null, null, 480));
    }

    [Fact]
    public void Inactive_equipment_is_rejected()
    {
        var plant = Guid.NewGuid();
        var errors = ProductionRecordRules.ValidateContext(EquipmentStatus.Inactive, plant, plant, new DateOnly(2026, 1, 5), new DateOnly(2026, 1, 6)).ToList();

        Assert.Contains(errors, e => e.Field == "EquipmentId");
    }

    [Fact]
    public void Shift_from_another_plant_is_rejected()
    {
        var errors = ProductionRecordRules.ValidateContext(EquipmentStatus.Active, Guid.NewGuid(), Guid.NewGuid(), new DateOnly(2026, 1, 5), new DateOnly(2026, 1, 6)).ToList();

        Assert.Contains(errors, e => e.Field == "ShiftId");
    }

    [Fact]
    public void Future_dates_are_rejected_but_today_and_tomorrow_are_allowed()
    {
        var plant = Guid.NewGuid();
        var today = new DateOnly(2026, 1, 6);

        Assert.Empty(ProductionRecordRules.ValidateContext(EquipmentStatus.Active, plant, plant, today, today));
        Assert.Empty(ProductionRecordRules.ValidateContext(EquipmentStatus.Active, plant, plant, today.AddDays(1), today));
        Assert.Contains(ProductionRecordRules.ValidateContext(EquipmentStatus.Active, plant, plant, today.AddDays(2), today), e => e.Field == "ShiftDate");
    }
}

public class DatabaseErrorsTests
{
    [Theory]
    [InlineData("23505", 409)]
    [InlineData("23001", 409)]
    [InlineData("23503", 400)]
    [InlineData("23514", 400)]
    [InlineData("23502", 400)]
    public void Known_constraint_errors_map_to_http_status(string sqlState, int expectedStatus)
    {
        var mapped = DatabaseErrors.FromSqlState(sqlState);

        Assert.NotNull(mapped);
        Assert.Equal(expectedStatus, mapped!.Value.Status);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("42P01")]
    [InlineData("08006")]
    public void Other_errors_are_not_mapped(string? sqlState)
    {
        Assert.Null(DatabaseErrors.FromSqlState(sqlState));
    }
}

public class QueryFiltersTests
{
    private static readonly DateOnly Today = new(2026, 10, 27);

    [Fact]
    public void Missing_dates_default_to_the_last_30_days_including_today()
    {
        var filter = new AnalyticsFilter();

        var error = QueryFilters.NormaliseRange(filter, Today);

        Assert.Null(error);
        Assert.Equal(Today, filter.To);
        Assert.Equal(new DateOnly(2026, 9, 28), filter.From);
    }

    [Fact]
    public void Start_after_end_is_an_error()
    {
        var filter = new AnalyticsFilter { From = new DateOnly(2026, 2, 1), To = new DateOnly(2026, 1, 1) };

        Assert.NotNull(QueryFilters.NormaliseRange(filter, Today));
    }

    [Fact]
    public void Ranges_over_the_maximum_are_an_error()
    {
        var filter = new AnalyticsFilter { From = Today.AddDays(-800), To = Today };

        Assert.NotNull(QueryFilters.NormaliseRange(filter, Today));
    }
}
