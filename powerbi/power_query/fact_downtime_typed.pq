// Optional refinement of fact_downtime: timestamps arrive as timestamptz (UTC). Convert to a local zone only if your report needs it;
// the KPI definitions in this project attribute downtime to the UTC date its event starts (date_key), so leave date_key alone.
let
    Source = fact_downtime,
    Typed  = Table.TransformColumnTypes(Source, {{"start_time", type datetimezone}, {"end_time", type datetimezone}, {"duration_minutes", Int64.Type}})
in
    Typed
