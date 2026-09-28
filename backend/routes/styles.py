"""Writing styles and the apps assigned to them (docs/plans/PER_APP_STYLE.md)."""

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..services import styles as styles_service
from ..services.captures import list_capture_apps, target_app

router = APIRouter(prefix="/writing-styles", tags=["writing-style"])


def _listing(db: Session) -> models.WritingStylesResponse:
    """Every style, and every app with captures or an assignment, with the style it uses."""
    snapshot = styles_service.snapshot()
    counted = {app.app_bundle_id: app for app in list_capture_apps(db).apps}
    apps = [
        models.StyledApp(
            bundle_id=app.app_bundle_id,
            name=app.app_name or snapshot.app_names.get(app.app_bundle_id),
            style_id=snapshot.for_app(app.app_bundle_id).id,
            confirmed=app.app_bundle_id in snapshot.apps,
            count=app.count,
        )
        for app in counted.values()
    ]
    apps += [
        models.StyledApp(
            bundle_id=bundle_id,
            name=snapshot.app_names.get(bundle_id),
            style_id=snapshot.for_app(bundle_id).id,
            confirmed=True,
        )
        for bundle_id in snapshot.apps
        if bundle_id not in counted
    ]
    return models.WritingStylesResponse(
        styles=[models.WritingStyleModel(**asdict(style)) for style in snapshot.styles],
        apps=apps,
    )


@router.get("", response_model=models.WritingStylesResponse)
async def list_styles(db: Session = Depends(get_db)):
    return _listing(db)


@router.post("", response_model=models.WritingStyleModel)
async def create_style(request: models.WritingStyleCreate, db: Session = Depends(get_db)):
    try:
        return asdict(styles_service.create_style(db, request.name))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.patch("/{style_id}", response_model=models.WritingStyleModel)
async def update_style(style_id: str, request: models.WritingStyleUpdate, db: Session = Depends(get_db)):
    try:
        style = styles_service.update_style(db, style_id, request.model_dump(exclude_none=True))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if style is None:
        raise HTTPException(status_code=404, detail="Style not found")
    return asdict(style)


@router.delete("/{style_id}", status_code=204)
async def delete_style(style_id: str, db: Session = Depends(get_db)):
    try:
        deleted = styles_service.delete_style(db, style_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if not deleted:
        raise HTTPException(status_code=404, detail="Style not found")


@router.put("/apps/{bundle_id}", response_model=models.WritingStylesResponse)
async def assign_app(bundle_id: str, request: models.AppStyleAssign, db: Session = Depends(get_db)):
    """Use ``style_id`` for an app; this also confirms a new app's style."""
    bundle, name = target_app(bundle_id, request.app_name)
    if bundle is None:
        raise HTTPException(status_code=400, detail="Name an app")
    try:
        styles_service.assign_app(db, bundle, name, request.style_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Style not found") from error
    return _listing(db)
