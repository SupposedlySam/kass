# Voice training

Beta (`voice_training`). Kass trains Whisper turbo on the user's own takes,
with other people talking and busy rooms mixed in, so it keeps following the
user's voice when it isn't quiet. Code: `backend/services/voice_training/`.

## Why

In October 2026 we measured background noise on 80 of the user's takes. Steady
fan noise did no harm, even at 0 dB. Another person talking was what broke
dictation: turbo's word error rate went from 3% on clean takes to 22% with a
talker 6 dB below the user and 74% at the same level. The other person's words
ended up in the transcript.

**Approaches that didn't help:**

- **Audio cleanup:** Apple Sound Isolation, RNNoise, DeepFilterNet, a level
  gate and a speaker-embedding gate. Apple's isolation keeps every voice.
- **Other recognizers:** Parakeet v3 and Apple SpeechAnalyzer were both much
  worse than turbo with talk in the background.
- **Filtering the text:** an LLM can't tell the user's words from the other
  person's.

**What worked:** a LoRA adapter on turbo, trained the way this feature trains.
- With a talker at 6 and 0 dB, errors fell to 8% and 9%.
- With meeting chatter it never trained on, errors went from 18% / 52% to
  5% / 8%.
- The user's corrected takes improved slightly.

## Data

### Voice bank (`bank.py`)

While idle, the manager scans dictations it hasn't seen, 400 per pass.

- **Clean takes** are copied into `voice-training/bank/` at 16 kHz with
  their transcript. A clean take is 1–28 s long, has at least 0.5 s of speech,
  a noise floor below −55 dBFS, and speech at least 25 dB above that floor.
- **Labels:** if the user fixed a take's raw transcript in Captures, the
  label is their fix. A re-dictation doesn't count.
- **Size:** the bank keeps the newest 2 hours of takes.
- **Room noise:** from noisy takes (floor above −50 dBFS), the stretches
  without speech go to `voice-training/room/`, 10 minutes at most.
- **Retention:** history retention doesn't delete bank copies. Deleting a
  capture removes its take, and Discard audio empties the bank.
- **Split:** each take is assigned once, by id, to training (85%) or test
  (15%) takes.

### Background sounds (`sounds.py`)

A one-time download started from Settings › Transcription.

| Source | License | Download | Use |
|---|---|---|---|
| LibriSpeech test-clean | CC BY 4.0 | about 346 MB | 40 speakers, 30 utterances each, as people talking |
| DEMAND restaurant, office and living room | CC BY-SA 3.0 | about 280 MB | Room noise |

Kass keeps about 350 MB, decoded to 16 kHz, in `voice-training/sounds/`.
Background jobs never download anything.

## Training (`train.py`, in the model-improvement worker)

A run needs:

- the beta turned on;
- Turbo as the transcription model, already downloaded;
- the background sounds;
- at least 100 training takes and 12 test takes.

The refinement adapter trains first. Voice training waits for a run of its own
so both fit in the worker's 30 minutes. While voice training is on, the
manager doesn't switch speech model sizes away from turbo.

**How a run trains:**

- **Starting point:** it continues from the last trained adapter (or the
  active one) for 15 minutes, with at most 250 updates.
- **Batching:** each update sums gradients over 4 single examples. That keeps
  memory near 10 GB, under the worker's 16 GB MLX limit.
- **Examples:**
  - 35% are clean.
  - The rest have a talker 3 dB above to 18 dB below the user, sometimes a
    second talker, room noise, or both.
  - 30% of examples carry earlier text as a prompt, like phrases later in a
    dictation.
- **Targets:** the take's transcript. The model learns to write the same
  text whatever is going on behind the user.

## Acceptance (`gate.py`)

The test takes are transcribed under fixed conditions. Each take and
condition always gets the same mix (`mixing.condition_mix`):

- clean,
- a talker 6 dB below the user,
- a talker at the same level,
- room noise 5 dB below.

The user's corrected takes, when there are some, are transcribed too. Each set
is transcribed by plain turbo, by the model in use, and by the candidate. The
candidate is activated only if all of these hold:

- with talk and noise, it makes at least 3% fewer mistakes than the model in
  use (and at least 2 fewer);
- on clean takes it is no worse than plain turbo, and no worse than the model
  in use, each allowing 0.5% of words, or 3% when it makes a quarter fewer
  noisy mistakes than that model (a big win in noise is worth a few clean
  mistakes; the user's call, 2026-10-02);
- on corrected takes it is no worse than the model in use;
- median latency is no worse than 1.1× + 50 ms, and memory no worse than
  1.2× + 512 MB.

**Continuing from a candidate:** the next run continues from a candidate
that beat the model in use with talk and noise, kept the corrected takes, and
lost at most 3% of clean words (`gate.worth_continuing`), even when it isn't
activated. Early training trades a little clean accuracy for a lot in noise.
In the first end-to-end run (2026-10-02, 160 updates, 15 minutes), mistakes
with talk and noise fell from 861 to 351, while clean takes went from 23 to 41
mistakes in 634 words. The candidate was rejected, but it was worth building
on. Restarting after every rejection would never get past that first stage.

Six more rounds on the same data (2026-10-02, about 1,200 updates in all):

| Round | Updates | Clean mistakes (634 words) | Noisy mistakes | Activated |
|---|---|---|---|---|
| plain turbo | | 23 | 862 | |
| 1 | 160 | 41 | 351 | yes |
| 2 | 327 | 41 | 300 | yes |
| 3 | 499 | 40 | 296 | no, too small a gain |
| 4 | 672 | 33 | 279 | yes |
| 5 | 846 | 32 | 267 | yes |
| 6 | 1,020 | 36 | 292 | no |
| 7 | 1,194 | 36 | 292 | no |

Clean drift came back from 41 to 32 mistakes, and noisy mistakes fell to
less than a third. Progress stalled after about 850 updates on 946 takes, so
new takes from everyday use are the likely next gain.

## Using it

The active voice model is `active.voice` in `model-improvement/state.json`:
its path and the SHA-256 of the adapter and its config.

**Integrity:** at startup, a voice model that fails its integrity check, or
lies outside the runs folder, is dropped.

**Loading:** `MLXSTTBackend` loads turbo and merges the adapter into its
weights (`lora.apply`), so recognition runs at turbo's speed. Its load key is
the model size plus the adapter path, so a promotion or Undo reloads it. If
turbo is in memory when that happens, it reloads right away.

**Failures:** if the adapter fails to load, Kass uses plain turbo and turns
the voice model off (`quarantine_voice`).

**Leaving the beta:** plain turbo is used again.

**Undo:** Settings › Transcription › Voice model › Undo restores the previous
model version, the same history the cleanup adapter uses. The next run then
continues from the restored model.
