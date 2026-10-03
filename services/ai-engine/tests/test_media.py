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


def test_reload_mid_interview_mixes_chunked_streams(storage_dir, client):
    """A page reload starts a new recorder: chunks of stream 1, then chunks of stream 2."""
    first = (RECORDING / "audio.webm").read_bytes()  # 14 s
    parts_dir = storage_dir / "recordings" / "reload" / "audio"
    parts_dir.mkdir(parents=True, exist_ok=True)
    make_tone(parts_dir / "tmp-second.webm", 3, 400)
    second = (parts_dir / "tmp-second.webm").read_bytes()
    (parts_dir / "tmp-second.webm").unlink()
    half = len(first) // 2
    chunks = [first[:half], first[half:], second[: len(second) // 2], second[len(second) // 2:]]
    for i, chunk in enumerate(chunks):
        (parts_dir / f"{i:05d}.webm").write_bytes(chunk)

    streams = media.group_into_streams(sorted(parts_dir.iterdir()))
    assert [len(s) for s in streams] == [2, 2]

    res = client.post("/media/concat", headers=AUTH, json={"prefix": "recordings/reload/audio/", "outKey": "recordings/reload/audio.webm"})
    assert res.status_code == 200, res.text
    assert abs(res.json()["durationMs"] - 17000) < 400


def test_leading_fragment_without_header_is_dropped(tmp_path):
    headerless = tmp_path / "00000.webm"
    headerless.write_bytes(b"\x00\x01fragment")
    whole = tmp_path / "00001.webm"
    whole.write_bytes((RECORDING / "audio.webm").read_bytes())
    assert media.group_into_streams([headerless, whole]) == [[whole]]


def test_concat_validation(client):
    assert client.post("/media/concat", headers=AUTH, json={"prefix": "recordings/none/", "outKey": "recordings/none/a.webm"}).status_code == 404
    assert client.post("/media/concat", headers=AUTH, json={"prefix": "recordings/none", "outKey": "recordings/none/a.webm"}).status_code == 400
