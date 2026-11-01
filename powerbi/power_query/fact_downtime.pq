// fact_downtime — one query per view in the "bi" schema. Rows are restricted to one organisation because Power BI has no tenant filter of its own.
let
    Source   = PostgreSQL.Database(Server, Database),
    Table    = Source{[Schema = "bi", Item = "fact_downtime"]}[Data],
    InOrg    = Table.SelectRows(Table, each [organisation_id] = OrganisationId),
    // organisation_id is only needed for the filter above; dropping it keeps the model free of an unused column.
    Result   = Table.RemoveColumns(InOrg, {"organisation_id"})
in
    Result
