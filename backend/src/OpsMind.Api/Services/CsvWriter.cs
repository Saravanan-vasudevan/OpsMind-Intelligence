using System.Globalization;

namespace OpsMind.Api.Services;

public static class CsvWriter
{
    /// <summary>
    /// Quotes a text cell when needed and neutralises spreadsheet formula injection: text starting with
    /// = + - @ tab or CR gets a leading apostrophe so Excel treats it as text.
    /// </summary>
    public static string EscapeText(string? value)
    {
        if (string.IsNullOrEmpty(value)) return string.Empty;

        var text = value;
        if (text[0] is '=' or '+' or '-' or '@' or '\t' or '\r')
        {
            text = "'" + text;
        }

        return Quote(text);
    }

    public static string Row(params object?[] cells) => string.Join(",", cells.Select(Cell));

    private static string Cell(object? cell) => cell switch
    {
        null => string.Empty,
        string text => EscapeText(text),
        DateOnly date => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        DateTime dateTime => dateTime.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture),
        IFormattable number => number.ToString(null, CultureInfo.InvariantCulture),
        _ => EscapeText(cell.ToString())
    };

    private static string Quote(string text) =>
        text.IndexOfAny(new[] { ',', '"', '\r', '\n' }) >= 0
            ? "\"" + text.Replace("\"", "\"\"") + "\""
            : text;
}
