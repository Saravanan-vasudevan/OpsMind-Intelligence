// dim_date — a complete calendar (2020-2035) from the database so every visual and time-intelligence measure has gap-free dates.
// After loading: Table tools > Mark as date table, using the [date] column.
let
    Source = PostgreSQL.Database(Server, Database),
    Table  = Source{[Schema = "bi", Item = "dim_date"]}[Data],
    Typed  = Table.TransformColumnTypes(Table, {{"date", type date}, {"date_key", Int64.Type}, {"is_weekend", type logical}}),
    // Sort month names chronologically rather than alphabetically (set "Sort by column" on month_name = month_number in the model).
    Result = Typed
in
    Result
