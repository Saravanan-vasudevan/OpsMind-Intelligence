// Create these three as Power Query parameters (Home > Manage Parameters > New Parameter).
// Server     : Text, e.g.  localhost:5432
// Database   : Text, e.g.  opsmind
// OrganisationId : Text, the uuid of the organisation to report on (select id from organisations;)
// A read-only database role is recommended:  GRANT USAGE ON SCHEMA bi TO powerbi;  GRANT SELECT ON ALL TABLES IN SCHEMA bi TO powerbi;
