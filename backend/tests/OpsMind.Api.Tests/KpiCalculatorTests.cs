using OpsMind.Api.Contracts;
using OpsMind.Api.Services;

namespace OpsMind.Api.Tests;

public class KpiCalculatorTests
{
    [Fact]
    public void Ratio_is_null_when_denominator_is_zero()
    {
        Assert.Null(KpiCalculator.Ratio(5, 0));
    }

    [Fact]
    public void Ratio_is_rounded_to_four_decimals()
    {
        Assert.Equal(0.3333m, KpiCalculator.Ratio(1, 3));
    }

    [Fact]
    public void Availability_removes_planned_downtime_from_the_base_and_subtracts_unplanned()
    {
        // Two 480-minute shifts, one hour planned maintenance, 90 minutes of breakdowns:
        // planned production time = 960 - 60 = 900; availability = (900 - 90) / 900 = 0.9
        Assert.Equal(0.9m, KpiCalculator.Availability(960, 60, 90));
    }

    [Fact]
    public void Availability_is_never_negative()
    {
        Assert.Equal(0m, KpiCalculator.Availability(480, 0, 600));
    }

    [Fact]
    public void Availability_is_null_when_no_planned_production_time_exists()
    {
        Assert.Null(KpiCalculator.Availability(60, 60, 0));
        Assert.Null(KpiCalculator.Availability(0, 0, 0));
    }

    [Fact]
    public void Summarise_with_no_data_returns_nulls_instead_of_zero_rates()
    {
        var summary = KpiCalculator.Summarise(ProductionTotals.Empty, DowntimeTotals.Empty);

        Assert.Equal(0, summary.RecordCount);
        Assert.Null(summary.TargetAttainment);
        Assert.Null(summary.Utilisation);
        Assert.Null(summary.Availability);
        Assert.Null(summary.DefectRate);
    }

    [Fact]
    public void Summarise_computes_each_rate_from_totals()
    {
        var production = new ProductionTotals(Records: 4, Units: 900, Target: 1000, RunMinutes: 800, ScheduledMinutes: 960, Inspected: 900, Rejected: 18);
        var downtime = new DowntimeTotals(Planned: 60, Unplanned: 90);

        var summary = KpiCalculator.Summarise(production, downtime);

        Assert.Equal(0.9m, summary.TargetAttainment);
        Assert.Equal(0.8333m, summary.Utilisation);
        Assert.Equal(0.9m, summary.Availability);
        Assert.Equal(0.02m, summary.DefectRate);
        Assert.Equal(60m, summary.PlannedDowntimeMinutes);
        Assert.Equal(90m, summary.UnplannedDowntimeMinutes);
    }
}

public class TrendBucketingTests
{
    private static TrendPoint Point(string date, long units, long inspected, long rejected) =>
        new(DateOnly.Parse(date), units, units, inspected, rejected, KpiCalculator.Ratio(rejected, inspected));

    [Fact]
    public void Day_granularity_keeps_points_unchanged()
    {
        var points = new[] { Point("2026-01-05", 10, 10, 1), Point("2026-01-06", 20, 20, 2) };

        var result = TrendBucketing.Bucket(points, "day");

        Assert.Equal(2, result.Count);
    }

    [Fact]
    public void Week_granularity_groups_monday_to_sunday()
    {
        // 5 Jan 2026 is a Monday, 11 Jan a Sunday, 12 Jan the next Monday.
        var points = new[]
        {
            Point("2026-01-05", 10, 100, 10),
            Point("2026-01-11", 20, 300, 0),
            Point("2026-01-12", 30, 100, 5)
        };

        var result = TrendBucketing.Bucket(points, "week");

        Assert.Equal(2, result.Count);
        Assert.Equal(new DateOnly(2026, 1, 5), result[0].Date);
        Assert.Equal(30, result[0].Units);
    }

    [Fact]
    public void Bucketed_defect_rate_is_recomputed_from_totals_not_averaged()
    {
        var points = new[] { Point("2026-01-05", 10, 100, 10), Point("2026-01-06", 10, 300, 0) };

        var result = TrendBucketing.Bucket(points, "week");

        // 10 rejected of 400 inspected = 0.025; averaging the daily rates (0.10 and 0.00) would give 0.05.
        Assert.Equal(0.025m, result[0].DefectRate);
    }

    [Fact]
    public void Month_granularity_splits_at_month_boundaries()
    {
        var points = new[] { Point("2026-01-31", 10, 10, 0), Point("2026-02-01", 10, 10, 0) };

        var result = TrendBucketing.Bucket(points, "month");

        Assert.Equal(2, result.Count);
        Assert.Equal(new DateOnly(2026, 2, 1), result[1].Date);
    }
}
