import subprocess

from conftest import AUTH, RECORDING
from core import media


def make_tone(path, seconds, freq):
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
                    f"sine=frequency={freq}:duration={seconds}", "-c:a", "libopus", str(path)], check=True)


def test_mediarecorder_style_byte_chunks_are_joined(storage_dir, client):
    """Timeslice chunks: only the first carries the WebM header."""
    data = (RECORDING / "audio.webm").read_bytes()
    parts_dir = storage_dir / "recordings" / "chunks" / "audio"
    parts_dir.mkdir(parents=True, exist_ok=True)
    third = len(data) // 3
    for i, chunk in enumerate([data[:third], data[third:2 * third], data[2 * third:]]):
        (parts_dir / f"part-{i:05d}.webm").write_bytes(chunk)
    assert not media._starts_with_header(parts_dir / "part-00001.webm")

    res = client.post("/media/concat", headers=AUTH, json={"prefix": "recordings/chunks/audio/", "outKey": "recordings/chunks/audio.webm"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["parts"] == 3
    assert abs(body["durationMs"] - 14000) < 300
    assert (storage_dir / "recordings/chunks/audio.webm").is_file()


def test_separate_files_are_concatenated(storage_dir, client):
    parts_dir = storage_dir / "recordings" / "files" / "audio"
    parts_dir.mkdir(parents=True, exist_ok=True)
    make_tone(parts_dir / "part-00000.webm", 2, 300)
    make_tone(parts_dir / "part-00001.webm", 3, 500)
    res = client.post("/media/concat", headers=AUTH, json={"prefix": "recordings/files/audio/", "outKey": "recordings/files/audio.webm"})
    assert res.status_code == 200, res.text
    assert abs(res.json()["durationMs"] - 5000) < 300


def test_concat_validation(client):
    assert client.post("/media/concat", headers=AUTH, json={"prefix": "recordings/none/", "outKey": "recordings/none/a.webm"}).status_code == 404
    assert client.post("/media/concat", headers=AUTH, json={"prefix": "recordings/none", "outKey": "recordings/none/a.webm"}).status_code == 400
