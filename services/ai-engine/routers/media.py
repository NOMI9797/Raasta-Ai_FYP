"""POST /media/concat — join uploaded recording parts into one file in storage."""
import tempfile
from contextlib import ExitStack
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core import media, storage

router = APIRouter(tags=["media"])

CONTENT_TYPES = {".webm": "video/webm", ".wav": "audio/wav", ".mp4": "video/mp4", ".ogg": "audio/ogg"}


class ConcatRequest(BaseModel):
    prefix: str = Field(min_length=1, max_length=512)
    outKey: str = Field(min_length=1, max_length=512)


@router.post("/media/concat")
def concat(request: ConcatRequest):
    storage.validate_key(request.outKey)
    if not request.prefix.endswith("/"):
        raise HTTPException(400, "prefix must end with /")
    keys = [k for k in storage.list_keys(request.prefix) if k != request.outKey]
    if not keys:
        raise HTTPException(404, "No parts found under prefix")

    suffix = Path(request.outKey).suffix or ".webm"
    with ExitStack() as stack, tempfile.TemporaryDirectory() as tmp:
        parts = [stack.enter_context(storage.local_file(k)) for k in keys]
        out = Path(tmp) / f"out{suffix}"
        media.concat_parts(parts, out)
        duration = media.duration_ms(out)
        storage.put_file(request.outKey, out, CONTENT_TYPES.get(suffix, "application/octet-stream"))
    return {"outKey": request.outKey, "durationMs": duration, "parts": len(keys)}
