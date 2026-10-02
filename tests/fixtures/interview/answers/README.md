# Interview answer fixtures

Synthetic speech for `scripts/interview-test-client.js`: 16 kHz, mono, PCM16 WAV. No real person's voice.

| File | Says |
|---|---|
| `greeting-ready.wav` | "Yes, I'm ready." |
| `q1-strong.wav` | "I would build the Docker image on every pull request, run the unit tests, push it to a registry, and deploy to Kubernetes with Helm. Terraform manages the AWS infrastructure, and a failed health check rolls the release back automatically." |
| `q1-weak.wav` | "I don't know, maybe Docker." |
| `q2-long-with-pause.wav` | "In my last job I moved our servers to AWS." · 5 s pause · "We used Terraform for the infrastructure and CloudWatch alarms for monitoring." |

Each clip has 0.5 s of leading silence and 1.5 s of trailing silence. Regenerate with espeak-ng and ffmpeg:

```bash
espeak-ng -v en-us -s 160 -w ready.raw.wav "Yes, I'm ready."
ffmpeg -i ready.raw.wav -af "adelay=500:all=1,apad=pad_dur=1.5" -ar 16000 -ac 1 -c:a pcm_s16le greeting-ready.wav
# q2: two utterances joined with a 5 s pad on the first
ffmpeg -i part1.raw.wav -i part2.raw.wav -filter_complex \
  "[0:a]aresample=16000,adelay=500:all=1,apad=pad_dur=5[a];[1:a]aresample=16000,apad=pad_dur=1.5[b];[a][b]concat=n=2:v=0:a=1" \
  -ar 16000 -ac 1 -c:a pcm_s16le q2-long-with-pause.wav
```
