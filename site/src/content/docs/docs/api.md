---
title: Local API
description: Use Herga's local server from your own scripts.
---

While Herga is running, its server listens on `http://127.0.0.1:17493`. It only accepts connections from your own Mac. Interactive API docs for every endpoint are at [`http://127.0.0.1:17493/docs`](http://127.0.0.1:17493/docs) while it's running.

## Examples

```bash
# Is the server up?
curl http://127.0.0.1:17493/health

# Transcribe an audio file
curl -X POST http://127.0.0.1:17493/transcribe \
  -F "file=@recording.wav" \
  -F "model=turbo"

# List your captures
curl http://127.0.0.1:17493/captures
```

## Endpoints

| Area | Endpoints |
| --- | --- |
| Health | `GET /health` |
| Transcription | `POST /transcribe` |
| Captures | `GET`/`POST /captures`, `GET`/`DELETE /captures/{id}`, `/captures/{id}/audio`, `/captures/{id}/refine`, `/captures/{id}/retranscribe`, `/captures/stats`, `/captures/apps` |
| Command Mode | `POST /commands/run` |
| Settings | `GET`/`PUT /settings/captures` |
| Dictionary | `/dictionary` |
| Writing styles | `/writing-styles` |
| Models | `/models/status`, `/models/download` |

The API follows the app, and can change between versions. Check `/docs` on your own install for the exact shapes.
