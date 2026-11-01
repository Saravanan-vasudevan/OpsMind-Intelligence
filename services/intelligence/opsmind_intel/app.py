"""HTTP API of the intelligence service.

Not exposed to browsers: ASP.NET Core calls it with a shared key and the caller's organisation/user ids. The service
trusts those headers because only the backend can reach it (docker network) and it checks the key on every call.
"""
from __future__ import annotations

import hmac
import logging
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response

from .anomaly.benchmark import run_benchmark
from .anomaly.service import AnomalyParameterError, detect
from .config import Settings, get_settings
from .db import connect
from .etl.pipeline import UploadError, run_import
from .forecasting.service import InsufficientHistory, MAX_HORIZON, METRICS, forecast, load_daily_series
from .logging_config import configure_logging
from .reports.workbook import ReportParameterError, build_report

log = logging.getLogger("opsmind.intel")
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

app = FastAPI(title="OpsMind intelligence service", version="2.0.0", docs_url=None, redoc_url=None, openapi_url="/openapi.json")


def problem(status: int, title: str, detail: str, code: str, **extra) -> JSONResponse:
    return JSONResponse({"type": f"urn:opsmind:{code}", "title": title, "status": status, "detail": detail, "code": code, **extra},
                        status_code=status, media_type="application/problem+json")


class ApiError(Exception):
    def __init__(self, status: int, title: str, detail: str, code: str, **extra):
        self.status, self.title, self.detail, self.code, self.extra = status, title, detail, code, extra


@app.exception_handler(ApiError)
async def _api_error(_: Request, exc: ApiError):
    return problem(exc.status, exc.title, exc.detail, exc.code, **exc.extra)


@app.exception_handler(RequestValidationError)
async def _validation(_: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", ()) if p != "query")
    return problem(400, "Invalid request", f"{where}: {first.get('msg', 'invalid value')}", "invalid_request")


@app.exception_handler(Exception)
async def _unexpected(request: Request, exc: Exception):
    log.exception("unhandled error", extra={"path": request.url.path})
    return problem(500, "Unexpected error", "The intelligence service hit an unexpected error.", "internal_error")


class Caller:
    def __init__(self, organisation_id: uuid.UUID, user_id: uuid.UUID | None):
        self.organisation_id, self.user_id = organisation_id, user_id


def caller(settings: Settings = Depends(get_settings), x_internal_key: str | None = Header(default=None),
           x_organisation_id: str | None = Header(default=None), x_user_id: str | None = Header(default=None)) -> Caller:
    if not settings.internal_api_key:
        raise ApiError(503, "Service not configured", "INTERNAL_API_KEY is not set.", "not_configured")
    if not x_internal_key or not hmac.compare_digest(x_internal_key.encode(), settings.internal_api_key.encode()):
        raise ApiError(401, "Unauthorised", "Missing or invalid internal key.", "unauthorised")
    try:
        org = uuid.UUID(x_organisation_id or "")
        user = uuid.UUID(x_user_id) if x_user_id else None
    except ValueError:
        raise ApiError(400, "Invalid caller", "X-Organisation-Id / X-User-Id must be UUIDs.", "invalid_caller")
    return Caller(org, user)


@app.get("/health")
def health(settings: Settings = Depends(get_settings)):
    try:
        with connect(settings.database_url) as conn:
            conn.execute("SELECT 1")
    except Exception:  # noqa: BLE001 - report any connectivity failure as unhealthy
        log.exception("health check failed")
        return JSONResponse({"status": "unhealthy"}, status_code=503)
    return {"status": "healthy"}


# ---------------------------------------------------------------- imports
@app.post("/imports")
async def import_file(file: UploadFile = File(...), kind: str = Form(...), conflict_policy: str = Form("skip"), strict: bool = Form(False),
                      who: Caller = Depends(caller), settings: Settings = Depends(get_settings)):
    content = await file.read(settings.max_upload_bytes + 1)
    if len(content) > settings.max_upload_bytes:
        raise ApiError(413, "File too large", f"The limit is {settings.max_upload_bytes // (1024 * 1024)} MB.", "file_too_large")
    try:
        result = run_import(settings.database_url, settings, who.organisation_id, who.user_id, file.filename or "upload", content,
                            kind, conflict_policy, strict)
    except UploadError as exc:
        raise ApiError(415 if exc.code == "unsupported_format" else (413 if exc.code == "file_too_large" else 400), "Upload not accepted", exc.message, exc.code)
    return result.to_dict()


# ---------------------------------------------------------------- forecasting
@app.get("/forecast")
def forecast_endpoint(metric: str = "units", horizon: int = Query(14), plant_id: uuid.UUID | None = Query(None, alias="plantId"),
                      equipment_id: uuid.UUID | None = Query(None, alias="equipmentId"), who: Caller = Depends(caller),
                      settings: Settings = Depends(get_settings)):
    if metric not in METRICS:
        raise ApiError(400, "Invalid metric", f"metric must be one of: {', '.join(METRICS)}", "invalid_metric")
    if not 1 <= horizon <= MAX_HORIZON:
        raise ApiError(400, "Invalid horizon", f"horizon must be between 1 and {MAX_HORIZON} days", "invalid_horizon")
    with connect(settings.database_url) as conn:
        names = _scope_names(conn, who.organisation_id, plant_id, equipment_id)
        series = load_daily_series(conn, who.organisation_id, metric, plant_id, equipment_id, history_days=365)
    if len(series.values) == 0:
        raise ApiError(422, "No data", "There are no production records for this scope.", "no_data")
    try:
        return forecast(series, metric, horizon, names)
    except InsufficientHistory as exc:
        raise ApiError(422, "Not enough history", str(exc), "insufficient_history")


def _scope_names(conn, org, plant_id, equipment_id) -> dict:
    scope = {"plantId": None, "plantName": None, "equipmentId": None, "assetCode": None}
    if plant_id:
        r = conn.execute("SELECT name FROM plants WHERE id = %s AND organisation_id = %s", (plant_id, org)).fetchone()
        if not r:
            raise ApiError(404, "Not found", "Plant not found.", "plant_not_found")
        scope.update(plantId=str(plant_id), plantName=r["name"])
    if equipment_id:
        r = conn.execute("""SELECT e.asset_code FROM equipment e JOIN production_lines l ON l.id = e.production_line_id
                            JOIN plants p ON p.id = l.plant_id WHERE e.id = %s AND p.organisation_id = %s""", (equipment_id, org)).fetchone()
        if not r:
            raise ApiError(404, "Not found", "Equipment not found.", "equipment_not_found")
        scope.update(equipmentId=str(equipment_id), assetCode=r["asset_code"])
    return scope


# ---------------------------------------------------------------- anomalies
@app.get("/anomalies")
def anomalies_endpoint(from_: date | None = Query(None, alias="from"), to: date | None = None, method: str = "robust_z",
                       plant_id: uuid.UUID | None = Query(None, alias="plantId"), equipment_id: uuid.UUID | None = Query(None, alias="equipmentId"),
                       threshold: float | None = None, limit: int = Query(100, ge=1, le=500), who: Caller = Depends(caller),
                       settings: Settings = Depends(get_settings)):
    end = to or datetime.now(timezone.utc).date() - timedelta(days=1)
    start = from_ or end - timedelta(days=29)
    with connect(settings.database_url) as conn:
        _scope_names(conn, who.organisation_id, plant_id, equipment_id)
        try:
            return detect(conn, who.organisation_id, start, end, method, plant_id, equipment_id, threshold, limit)
        except AnomalyParameterError as exc:
            raise ApiError(400, "Invalid parameters", str(exc), "invalid_parameters")


@app.get("/anomalies/evaluation")
def evaluation(_: Caller = Depends(caller)):
    """Synthetic benchmark. Independent of the caller's data; deterministic (fixed seed), so it is computed once per process."""
    global _BENCHMARK
    if _BENCHMARK is None:
        _BENCHMARK = run_benchmark()
    return _BENCHMARK


_BENCHMARK: dict | None = None


# ---------------------------------------------------------------- reports
@app.get("/reports/operations.xlsx")
def operations_report(from_: date = Query(..., alias="from"), to: date = Query(...), plant_id: uuid.UUID | None = Query(None, alias="plantId"),
                      include_anomalies: bool = Query(True, alias="includeAnomalies"), who: Caller = Depends(caller),
                      settings: Settings = Depends(get_settings)):
    with connect(settings.database_url) as conn:
        try:
            data = build_report(conn, who.organisation_id, from_, to, plant_id, include_anomalies)
        except ReportParameterError as exc:
            raise ApiError(400, "Invalid report parameters", str(exc), "invalid_parameters")
    name = f"opsmind-operations-{from_.isoformat()}-to-{to.isoformat()}.xlsx"
    return Response(data, media_type=XLSX, headers={"Content-Disposition": f'attachment; filename="{name}"'})
