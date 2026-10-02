"""Usage report endpoints: the app says how each take ended (services/usage_report.py)."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..services import usage_report

router = APIRouter(prefix="/usage", tags=["usage"])


@router.post("/takes", status_code=204)
async def record_take_endpoint(report: models.TakeReportRequest, db: Session = Depends(get_db)):
    usage_report.record_take(db, report.mode, report.outcome, report.latency_ms)
