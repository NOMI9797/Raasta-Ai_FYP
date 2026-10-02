import pytest

from conftest import AUTH
from core import storage


@pytest.mark.parametrize("key", ["../etc/passwd", "/abs", "a/../../b", "a//b", "a\\b", "", "x.meta.json", "a/./b"])
def test_invalid_keys_are_rejected(key):
    with pytest.raises(storage.StorageError):
        storage.validate_key(key)


def test_local_paths_stay_inside_the_storage_folder(storage_dir):
    assert storage_dir.resolve() in storage.local_path("recordings/x/a.webm").parents


def test_put_list_and_read_back(tmp_path, storage_dir):
    src = tmp_path / "f.txt"
    src.write_text("hello")
    storage.put_file("misc/a/one.txt", src, "text/plain")
    storage.put_file("misc/a/two.txt", src, "text/plain")
    assert storage.list_keys("misc/a/") == ["misc/a/one.txt", "misc/a/two.txt"]
    assert storage.list_keys("misc/a/t") == ["misc/a/two.txt"]
    assert (storage_dir / "misc/a/one.txt.meta.json").read_text() == '{"contentType": "text/plain"}'
    with storage.local_file("misc/a/one.txt") as p:
        assert p.read_text() == "hello"


def test_missing_object_is_404_and_bad_key_400(client):
    assert client.post("/analyze/voice", headers=AUTH, json={"audioKey": "recordings/nope/audio.webm"}).status_code == 404
    assert client.post("/analyze/voice", headers=AUTH, json={"audioKey": "../secret.webm"}).status_code == 400
