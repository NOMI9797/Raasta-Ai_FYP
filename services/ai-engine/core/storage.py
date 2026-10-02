"""Object storage access by key, matching libs/hiring/storage.js.

Keys look like "recordings/<interviewId>/audio.webm". The local driver reads the same
STORAGE_LOCAL_DIR as the Node services (including their .meta.json content-type sidecars);
the s3 driver downloads to a temporary file.
"""
import json
import os
import shutil
import tempfile
from contextlib import contextmanager
from pathlib import Path

from core import config

META_SUFFIX = ".meta.json"


class StorageError(Exception):
    """Invalid key or storage misconfiguration."""


class StorageNotFound(StorageError):
    """No object stored under the key."""


def validate_key(key: str) -> str:
    if (
        not isinstance(key, str)
        or not key
        or len(key) > 512
        or key.startswith("/")
        or "\\" in key
        or "\0" in key
        or key.endswith(META_SUFFIX)
        or any(part in ("", ".", "..") for part in key.split("/"))
    ):
        raise StorageError("Invalid storage key")
    return key


def _base_dir() -> Path:
    return Path(config.STORAGE_LOCAL_DIR).resolve()


def local_path(key: str) -> Path:
    """Absolute path for a key under STORAGE_LOCAL_DIR (local driver only)."""
    validate_key(key)
    base = _base_dir()
    full = (base / key).resolve()
    if base not in full.parents:
        raise StorageError("Invalid storage key")
    return full


def _s3_client():
    import boto3  # imported lazily: local development doesn't need it

    if not config.S3_BUCKET:
        raise StorageError("S3_BUCKET is not set")
    return boto3.client(
        "s3",
        region_name=config.S3_REGION,
        endpoint_url=config.S3_ENDPOINT,
        aws_access_key_id=config.S3_ACCESS_KEY_ID,
        aws_secret_access_key=config.S3_SECRET_ACCESS_KEY,
    )


def _driver() -> str:
    driver = config.STORAGE_DRIVER
    if driver not in ("local", "s3"):
        raise StorageError(f'Unknown STORAGE_DRIVER "{driver}"')
    return driver


@contextmanager
def local_file(key: str):
    """Yield a local filesystem path holding the object's bytes."""
    validate_key(key)
    if _driver() == "local":
        path = local_path(key)
        if not path.is_file():
            raise StorageNotFound(key)
        yield path
        return

    suffix = Path(key).suffix
    fd, tmp = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    try:
        try:
            _s3_client().download_file(config.S3_BUCKET, key, tmp)
        except Exception as exc:  # botocore raises ClientError with a 404 code
            if "404" in str(exc) or "NoSuchKey" in str(exc) or "Not Found" in str(exc):
                raise StorageNotFound(key) from exc
            raise
        yield Path(tmp)
    finally:
        Path(tmp).unlink(missing_ok=True)


def exists(key: str) -> bool:
    validate_key(key)
    if _driver() == "local":
        return local_path(key).is_file()
    try:
        _s3_client().head_object(Bucket=config.S3_BUCKET, Key=key)
        return True
    except Exception:
        return False


def put_file(key: str, source: Path, content_type: str = "application/octet-stream") -> str:
    """Store a local file under the key."""
    validate_key(key)
    if _driver() == "local":
        target = local_path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        (target.parent / (target.name + META_SUFFIX)).write_text(json.dumps({"contentType": content_type}))
        return key
    _s3_client().upload_file(str(source), config.S3_BUCKET, key, ExtraArgs={"ContentType": content_type})
    return key


def list_keys(prefix: str = "") -> list[str]:
    """Keys starting with prefix, sorted."""
    if _driver() == "local":
        base = _base_dir()
        start = (base / prefix).resolve() if prefix else base
        if start != base and base not in start.parents:
            raise StorageError("Invalid prefix")
        directory = start if prefix.endswith("/") or start == base else start.parent
        if not directory.is_dir():
            return []
        keys = []
        for path in directory.rglob("*"):
            if path.is_file() and not path.name.endswith(META_SUFFIX):
                key = path.relative_to(base).as_posix()
                if key.startswith(prefix):
                    keys.append(key)
        return sorted(keys)

    client = _s3_client()
    keys, token = [], None
    while True:
        kwargs = {"Bucket": config.S3_BUCKET, "Prefix": prefix}
        if token:
            kwargs["ContinuationToken"] = token
        page = client.list_objects_v2(**kwargs)
        keys.extend(item["Key"] for item in page.get("Contents", []))
        if not page.get("IsTruncated"):
            break
        token = page.get("NextContinuationToken")
    return sorted(keys)
