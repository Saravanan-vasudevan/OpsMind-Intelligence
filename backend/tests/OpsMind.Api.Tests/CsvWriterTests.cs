using OpsMind.Api.Services;

namespace OpsMind.Api.Tests;

public class CsvWriterTests
{
    [Fact]
    public void Plain_text_is_not_quoted()
    {
        Assert.Equal("Press 1", CsvWriter.EscapeText("Press 1"));
    }

    [Fact]
    public void Text_with_comma_is_quoted()
    {
        Assert.Equal("\"a,b\"", CsvWriter.EscapeText("a,b"));
    }

    [Fact]
    public void Quotes_are_doubled()
    {
        Assert.Equal("\"He said \"\"hi\"\"\"", CsvWriter.EscapeText("He said \"hi\""));
    }

    [Fact]
    public void Newlines_are_quoted()
    {
        Assert.Equal("\"a\nb\"", CsvWriter.EscapeText("a\nb"));
    }

    [Theory]
    [InlineData("=SUM(A1:A9)", "'=SUM(A1:A9)")]
    [InlineData("+1+1", "'+1+1")]
    [InlineData("-cmd", "'-cmd")]
    [InlineData("@name", "'@name")]
    public void Formula_prefixes_in_text_are_neutralised(string input, string expected)
    {
        Assert.Equal(expected, CsvWriter.EscapeText(input));
    }

    [Fact]
    public void Negative_numbers_are_not_treated_as_formulas()
    {
        Assert.Equal("-5,2.5", CsvWriter.Row(-5, 2.5m));
    }

    [Fact]
    public void Row_formats_nulls_dates_and_text()
    {
        var row = CsvWriter.Row(new DateOnly(2026, 1, 5), "Plant, North", null, 42);

        Assert.Equal("2026-01-05,\"Plant, North\",,42", row);
    }
}
