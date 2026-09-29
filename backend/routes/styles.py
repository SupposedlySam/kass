"""Writing styles and the apps assigned to them (docs/plans/PER_APP_STYLE.md)."""

import logging
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..services import styles as styles_service
from ..services.captures import list_capture_apps, target_app

router = APIRouter(prefix="/writing-styles", tags=["writing-style"])
logger = logging.getLogger(__name__)


def _cache_mb(db: Session, snapshot) -> int | None:
    """What one style's cached prompt takes in the cleanup model, in MB: the
    largest current style's, since a style's prompt grows as it learns."""
    from ..services.refinement import style_cache_bytes
    from ..services.settings import get_capture_settings

    saved = get_capture_settings(db)
    sizes = []
    for style in snapshot.styles:
        try:
            sizes.append(style_cache_bytes(styles_service.flags_for(style, saved), saved.llm_model))
        except Exception:
            logger.warning("Could not estimate a style's cache size", exc_info=True)
    sizes = [size for size in sizes if size]
    return round(max(sizes) / 1e6) if sizes else None


def _listing(db: Session) -> models.WritingStylesResponse:
    """Every style, and every app with captures or an assignment, with the style it uses."""
    snapshot = styles_service.snapshot()
    counted = {app.app_bundle_id: app for app in list_capture_apps(db).apps}
    corrections = styles_service.app_corrections(db)
    apps = [
        models.StyledApp(
            bundle_id=app.app_bundle_id,
            name=app.app_name or snapshot.app_names.get(app.app_bundle_id),
            style_id=snapshot.for_app(app.app_bundle_id).id,
            confirmed=app.app_bundle_id in snapshot.apps,
            count=app.count,
            corrections=corrections.get(app.app_bundle_id, 0),
            suggested_style_id=app.suggested_style_id,
        )
        for app in counted.values()
    ]
    apps += [
        models.StyledApp(
            bundle_id=bundle_id,
            name=snapshot.app_names.get(bundle_id),
            style_id=snapshot.for_app(bundle_id).id,
            confirmed=True,
            corrections=corrections.get(bundle_id, 0),
        )
        for bundle_id in snapshot.apps
        if bundle_id not in counted
    ]
    return models.WritingStylesResponse(
        styles=[models.WritingStyleModel(**asdict(style)) for style in snapshot.styles],
        apps=apps,
        max_styles=styles_service.MAX_STYLES,
        cache_mb_per_style=_cache_mb(db, snapshot),
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


@router.post("/apps/confirm", response_model=models.WritingStylesResponse)
async def confirm_apps(request: models.AppsConfirm, db: Session = Depends(get_db)):
    """Keep every listed new app in the style it already uses."""
    apps = [target_app(app.bundle_id, app.app_name) for app in request.apps]
    styles_service.confirm_apps(db, [(bundle, name) for bundle, name in apps if bundle])
    return _listing(db)


@router.put("/apps/{bundle_id}", response_model=models.WritingStylesResponse)
async def assign_app(bundle_id: str, request: models.AppStyleAssign, db: Session = Depends(get_db)):
    """Use ``style_id`` for an app; this also confirms a new app's style.

    ``corrections`` says whether the app's corrections come along or stay
    teaching the style it leaves.
    """
    bundle, name = target_app(bundle_id, request.app_name)
    if bundle is None:
        raise HTTPException(status_code=400, detail="Name an app")
    try:
        styles_service.assign_app(db, bundle, name, request.style_id, request.corrections)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Style not found") from error
    return _listing(db)
