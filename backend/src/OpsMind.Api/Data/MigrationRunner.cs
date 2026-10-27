using System.Security.Cryptography;
using System.Text;
using Npgsql;

namespace OpsMind.Api.Data;

/// <summary>
/// Applies the embedded SQL migration scripts in name order and records each one in schema_migrations
/// with a checksum, so an already-applied script that is edited later is detected instead of silently ignored.
/// </summary>
public static class MigrationRunner
{
    private const long AdvisoryLockKey = 727274;
    private const string ResourcePrefix = "Migrations.";

    public static async Task ApplyAsync(string connectionString, ILogger logger, CancellationToken cancellationToken)
    {
        const int maxAttempts = 5;
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await ApplyOnceAsync(connectionString, logger, cancellationToken);
                return;
            }
            catch (NpgsqlException ex) when (attempt < maxAttempts)
            {
                logger.LogWarning(ex, "Database not ready (attempt {Attempt}/{Max}); retrying in 3 seconds", attempt, maxAttempts);
                await Task.Delay(TimeSpan.FromSeconds(3), cancellationToken);
            }
        }
    }

    private static async Task ApplyOnceAsync(string connectionString, ILogger logger, CancellationToken ct)
    {
        var assembly = typeof(MigrationRunner).Assembly;
        var scripts = assembly.GetManifestResourceNames()
            .Where(n => n.StartsWith(ResourcePrefix, StringComparison.Ordinal) && n.EndsWith(".sql", StringComparison.Ordinal))
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToList();

        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync(ct);

        await ExecuteAsync(connection, null, $"SELECT pg_advisory_lock({AdvisoryLockKey})", ct);
        try
        {
            await ExecuteAsync(connection, null,
                "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())", ct);

            var applied = new Dictionary<string, string>();
            await using (var read = new NpgsqlCommand("SELECT name, checksum FROM schema_migrations", connection))
            await using (var reader = await read.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct))
                {
                    applied[reader.GetString(0)] = reader.GetString(1);
                }
            }

            foreach (var resource in scripts)
            {
                var name = resource[ResourcePrefix.Length..];
                string sql;
                await using (var stream = assembly.GetManifestResourceStream(resource)!)
                using (var streamReader = new StreamReader(stream, Encoding.UTF8))
                {
                    sql = await streamReader.ReadToEndAsync(ct);
                }

                var checksum = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(sql)));

                if (applied.TryGetValue(name, out var existing))
                {
                    if (!string.Equals(existing, checksum, StringComparison.Ordinal))
                    {
                        throw new InvalidOperationException(
                            $"Migration {name} was changed after it was applied. Add a new migration instead of editing an applied one.");
                    }
                    continue;
                }

                logger.LogInformation("Applying migration {Migration}", name);
                await using var transaction = (NpgsqlTransaction)await connection.BeginTransactionAsync(ct);
                await ExecuteAsync(connection, transaction, sql, ct);
                await using (var record = new NpgsqlCommand(
                                 "INSERT INTO schema_migrations (name, checksum) VALUES (@name, @checksum)", connection, transaction))
                {
                    record.Parameters.AddWithValue("name", name);
                    record.Parameters.AddWithValue("checksum", checksum);
                    await record.ExecuteNonQueryAsync(ct);
                }
                await transaction.CommitAsync(ct);
            }
        }
        finally
        {
            await ExecuteAsync(connection, null, $"SELECT pg_advisory_unlock({AdvisoryLockKey})", ct);
        }
    }

    private static async Task ExecuteAsync(NpgsqlConnection connection, NpgsqlTransaction? transaction, string sql, CancellationToken ct)
    {
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        await command.ExecuteNonQueryAsync(ct);
    }
}
