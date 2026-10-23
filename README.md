# Sguardo

English | [Italiano](README.it.md)

Write and speak with your eyes using an ordinary webcam, on a PC or a phone.
Designed for people who cannot move or speak (for example with ALS), and for those who care for them.

- **Gaze tracking in the browser** with MediaPipe Face Landmarker: the camera video never leaves
  the device.
- **Two-step keyboard** with word suggestions, **quick phrases** and personal phrases,
  **continuous writing** (Dasher-style) as an alternative.
- **Cloned voice** (optional) from the person's own voice, using a few voice messages or a recording,
  generated on your PC without any external service.
- Everything can be used with the eyes: select by fixating on a cell, open the menu by closing the
  eyes for 2 seconds, automatic recalibration when the person changes posture.

## What you need

| For | You need |
|---|---|
| Using Sguardo | A recent browser (Chrome, Edge, Firefox, Safari) and any webcam, including a laptop or phone camera |
| Running it on your own PC | [Python](https://www.python.org/downloads/) 3.10–3.13 (tested with 3.12), only to serve the files |
| The cloned voice (optional) | Python 3.10–3.13, [ffmpeg](https://ffmpeg.org/download.html), about 4 GB of disk space (libraries + model), any PC: no graphics card needed |
| The analysis tools (optional) | [Node.js](https://nodejs.org/) 20 or later |

**Python is not required.** The part that follows the eyes, the keyboard and the suggestions is a
static web page: it works with any file server, for example GitHub Pages, and in that case it uses
the browser's voice. Python is only needed to run it on your own PC with `serve.py` and for the
cloned voice.

## Installation

```
git clone https://github.com/PaoloDeLuise/sguardo.git
cd sguardo
```

(or download the repository ZIP and unzip it).

### Tracking and keyboard only

There is nothing to install: Python is enough.

```
python serve.py
```

and open **http://localhost:8000**. On macOS and Linux the command may be `python3`.

### With the cloned voice

1. Install ffmpeg:
   - Windows: `winget install Gyan.FFmpeg` (then reopen the terminal)
   - macOS: `brew install ffmpeg`
   - Linux (Debian/Ubuntu): `sudo apt install ffmpeg`
2. Create a separate Python environment and install the dependencies (about 1.5 GB):

   Windows:
   ```
   python -m venv .venv-voce
   .venv-voce\Scripts\python -m pip install -r requirements-voce.txt
   .venv-voce\Scripts\python serve.py
   ```
   macOS / Linux:
   ```
   python3 -m venv .venv-voce
   .venv-voce/bin/python -m pip install -r requirements-voce.txt
   .venv-voce/bin/python serve.py
   ```
3. Open **http://localhost:8000**. In the **Voice** section of the start screen:
   1. accept the XTTS-v2 model license (non-commercial use only, see [Licenses](#licenses)):
      only then is the model (about 1.8 GB) downloaded, just once;
   2. choose 10–30 seconds of the person's voice messages (WhatsApp ones are fine) or
      press **Record** and read the text shown;
   3. press **Clone the voice**, then try a phrase with **Listen**.

   More clean voice messages make the timbre more stable (up to about 30 seconds the intonation
   improves too). Samples add up: **Delete voice** starts again from zero.

From then on, `serve.py` must always be started with the Python from `.venv-voce`.

## From a phone or tablet

The camera in the browser only works from `localhost` or over **HTTPS**. Three ways:

1. **Published site (the simplest, without the cloned voice).** Publish the repository with
   GitHub Pages (*Settings → Pages → Deploy from a branch → main*) and open the address from the phone.
   GitHub Pages is free for public repositories.
2. **From the PC on the same Wi-Fi (also with the cloned voice).** You need the `cryptography`
   package to create the certificate (already included if you installed the voice):
   ```
   python -m pip install -r requirements.txt
   python serve.py --https
   ```
   prints an address `https://<ip-of-the-pc>:8443` to open on the phone. The certificate is
   self-signed: the browser shows a warning that you need to accept. If the phone cannot reach the PC:
   - Windows blocks incoming connections on "public" networks: set the Wi-Fi as a private
     network, or allow Python in the firewall;
   - some networks (corporate, guest) isolate devices from each other: in that case use way 3.

   The cloned voice can be used from the phone, but it is prepared and edited only from the PC.
3. **HTTPS tunnel** (for example `cloudflared tunnel --url http://localhost:8000`): works from
   any network, but makes the page reachable from the internet for as long as the tunnel is open.

On small screens the caregiver bar is hidden (it reopens with ⚙), in portrait the grid becomes
3×4 and continuous writing places the letters along the long side of the screen.
A tablet is still more comfortable: cells are larger relative to the gaze error.
On a phone the background is light: the screen close to the face lights it up, the camera amplifies
the signal less and the face points are less noisy. From the menu: **Background: automatic /
light / dark** (after changing it, it is best to recalibrate, because the light on the face changes).

The phone should be fixed on a stand, at eye level, and not held in the hand: every movement of
the phone changes the estimate like a movement of the head. Portrait and landscape have separate
calibrations: when you rotate the phone, recalibration starts by itself (full the first time, quick
afterwards). Also when the window changes size (the address bar appearing, full screen closing)
Sguardo offers to recalibrate. Next to the camera thumbnail you can see the frames per second:
below about 15 the gaze jitters more.

## Usage

The caregiver presses **Start camera** once (the browser requires it). From then on everything is
done with the eyes.

1. **Calibration.** The first time, the person follows with their eyes the dot that slides from one
   position to another, fixating on it when it stops (about 50 seconds). Later, a 10-second
   **quick recalibration** is enough: the model also uses the saved calibrations, weighted by how
   closely their posture resembles the current one. At the end the person chooses **Continue** or
   **Recalibrate** by fixating on the cell (after 10 seconds it continues on its own).
2. **Keyboard.** Fixate on a group of letters (1 second), then on the letter.
   - The first row offers three words; the suggestions learn from the person's phrases.
   - **Speak** reads the phrase aloud; when the text is empty it becomes **Repeat**.
   - **Delete** removes one letter; if you keep looking at it, it removes a whole word every 1.5 s.
   - Numbers and punctuation: group **Z J K W X Y / . , ? 123**, then **123**.
3. **Phrases.** Ten phrases for needs (Yes, No, Help, Water, Pain...). In **My phrases** you
   save the last phrase spoken (**Save**) and remove those that are no longer useful.
4. **Menu: eyes closed for 2 seconds.** Recalibrate, fixation time, visible dot,
   **continuous writing**: the letters arrive from the top, side by side and as large as they are
   probable; you look up, toward the wanted letter, to move forward and down to go back (and
   delete). From the menu you can switch to the vertical version (letters from the right).
5. **Handwriting** (menu → *Handwriting*, or **Handwriting** in the bar, or the `H` key):
   the pointer draws a letter or a whole word. Designed for head mode, but
   it works in all of them. It is only active when you choose it: nothing changes for those who use the keyboard.
   - **Pen:** a pointer has no button. The pen goes **down** in one of three ways, chosen in the menu
     (*Handwriting* → *Pen*; the level of the gesture is shown in a bar at the bottom of the
     drawing, and the gesture triggers when it passes the mark):
     - **wink** (default): one eye closed for an instant (0.15 s and at least three
       frames: on a phone, with few frames per second, an isolated flicker is not enough). A
       blink with both eyes does not count;
     - **open mouth**: the jaw is independent of the pointer and the signal is strong even with
       the phone camera;
     - **side cell**: you fixate on the **Pen** cell and the preparation starts from when the
       pointer **re-enters** the drawing area. It requires no gesture.

     **Preparation:** the pen does not go down instantly. For 0.8 seconds (adjustable in the menu)
     a ghost pointer appears with a circle that fills up, you position yourself calmly and the
     pen goes down at the end, where the pointer is. Repeating the gesture during the preparation
     cancels it (with the cell, leave the area).

     **Lifting the pen** depends on the mode:
     - **wink**: only by winking again (or by leaving the area). Staying still lifts
       nothing and leaving the area does not cut the stroke;
     - **open mouth**: only by opening the mouth again (or by leaving the area, without cutting anything).
       Opening the mouth moves the head, and therefore the pointer, so the points drawn *since
       the gesture began* are removed from the stroke (not only since it triggered: opening it
       slowly drags the pointer for half a second);
     - **cell**: by staying still (about 0.7 s, with a circle that fills up around the pointer and
       taking tremor into account), or by **leaving the area** toward the cell. In that case the
       points of the exit path are removed and the stroke goes back to the last **pause** at the end of the stroke: before
       going to the cell, stop for a moment where the stroke ends (without a pause only the
       last instants are removed). The exit cut exists only in this mode.

     With the cell, the pen lifts when still only if you moved first: right after it goes down,
     staying still does not lift it again. If it lifts too often while you are thinking, lengthen the wait in the menu. With
     the gestures there is no lifting when still.

     The gesture **threshold** is adjusted in the menu (*Easier gesture / Harder gesture*): on a
     phone the signals are noisier than on a laptop. With the pen up the pointer
     moves without leaving a mark.
   - **Letter or word:** you write **separate letters in a row from left to right**. The letters
     are separated automatically by position (the bar of the E or the dot of the I stay with
     their letter), in any order of strokes. A single letter is added to the word in
     progress; several letters are a word and are written with a space. Multi-stroke letters (E, F,
     H, T...) are made by lifting the pen between one stroke and the next.
   - **End of the drawing:** once the *pause between drawings* (2 s, adjustable in the menu) has passed since the last
     stroke, everything is read and the area is cleared.
   - **Recognition:** each letter is compared with letter templates ($P), then the word
     is chosen from the dictionary using all the letters together (a crooked R inside "casa" becomes A);
     a name that is not in the dictionary comes out as written. A single letter is helped by the language (after
     "cas" an A is more likely than an R). Nothing needs to be downloaded and it runs on any PC
     (about 25 ms per letter). **It does not read cursive writing**, with joined letters.
   - **Corrections:** next to the drawing the cells offer two words and, right after a drawing,
     two **alternatives** ("maybe", letters or words). Choosing one replaces what was
     written and **teaches** those drawings to Sguardo, which recognizes them better next time (they are
     forgotten from the menu). Accents, numbers and punctuation: from the **Keyboard**.
   - **Verification status:** tested in the interface (with the mouse), with distorted synthetic
     drawings (`node tools/test-recognizer.mjs`, `tools/test-words.mjs`) and with a simulated
     pointer for the pen (`tools/test-draw-pen.mjs`), not yet with a person drawing with
     the head: the real accuracy depends on the pointer's tremor and will only be known by trying.
6. **Posture change.** If the head stays shifted or tilted for more than 3 seconds a
   warning appears and after 5 seconds the quick recalibration starts. **Not now** postpones it by 3 minutes.
   (It only applies to eye control: with the head, moving it is the command.)

### Control: eyes, head or eyes + head

What moves the pointer is chosen from the start screen, from the caregiver bar or from the menu
with the eyes (**Control**). Each mode has its own calibration, its own folder of
saved calibrations and its own instructions: changing it starts a calibration (full the first time,
then quick).

| Mode | The pointer follows | Designed for |
|---|---|---|
| **Eyes** (default) | the gaze, with the head still | those who cannot move anything else |
| **Head** | the orientation and position of the face, like a pointer on the nose | those who can still move the head but have tired or imprecise eyes |
| **Eyes + head** | the head moves it roughly, the eyes refine | those who have a little of both |

- During calibration the dot must be followed with the head (or with eyes and head together) and
  **the corners of the screen must be reached too**: the range of movement is personal and the system learns it
  from there.
- With the head the resting position drifts and the neck gets tired: **Recenter** (menu) asks you to
  point at the center of the screen for 3 seconds and brings the estimated position back there.
- **Verification status:** the head modes have been tested only with synthetic data and
  in the interface, not with people moving their heads. The recordings collected so far are with
  the head still, so `node tools/evaluate.mjs --modes` says nothing about the "head" mode (368 px,
  no movement to learn from); it does show instead that adding head position to the
  eyes, with the head still, does not worsen the estimate (104 px against 103 px for eyes alone). To measure it
  properly, calibrations made while moving the head are needed, saved with **Save data**.

Normal blinks do not interrupt fixation, and neither does gaze jitter:
each cell accumulates "evidence" when the gaze falls near it and slowly loses it when it is not
being looked at, so a brief exit does not restart from zero. While looking you see the candidate
cells fill up; the one in the lead is highlighted.

**For caregivers:**

- clicking on a point while the person is looking at it = one more calibration point (green circle;
  gray if the eye was moving). Right-click calibrates without selecting anything;
- keys: `C` full calibration, `R` quick, `M` menu, `D` continuous writing, `H` handwriting, `P` dot,
  `Esc` interrupts the calibration;
- **New person** deletes the saved calibrations (when Sguardo passes to another person);
- `http://localhost:8000/?mouse`: the mouse stands in for the gaze, to try without a camera.

### Cloned voice timings

Measured on an i7-1255U laptop without a graphics card: model startup 18 s (once),
cloning 1–2 s, short phrase 3–5 s, in general about 2.5 times the duration of the phrase. On slower
PCs the times grow in proportion. To avoid making the person wait:

- quick phrases and saved ones are generated once and stored (then they start in 0.2 s);
- while the person writes, the phrase is prepared at every finished word;
- the model is compressed to 8 bits (about 30% faster; `SGUARDO_INT8=0` turns it off);
- if the cloned voice does not respond, the browser's voice is used.

## Privacy and security

- **Video:** processed only in the browser; it is neither saved nor sent.
- **Data saved in the browser** (`localStorage`): calibrations, settings, the person's words and
  phrases. **New person** deletes the calibrations; the site data is deleted from the
  browser settings.
- **Data saved on the PC** (only with `serve.py`): `voce/` (voice messages, cloned voice, generated phrases;
  of the written ones only the last 100 are kept) and `recordings/` (calibrations saved with **Save data**,
  they contain the face points). Both folders are excluded from the repository and `serve.py` never
  serves them.
- **External connections:** only to download MediaPipe (jsDelivr), the face model (Google) and,
  once, the voice model. The page has a Content Security Policy that allows nothing else.
- **`serve.py`:** accepts requests only from the Sguardo page (check of `Host` and `Origin` and
  the `X-Sguardo` header, against requests from other sites and DNS rebinding). Operations that
  modify data (voice messages, cloning, recordings) are allowed only from the PC itself. It is a server
  meant for personal use, not for being exposed to the internet.
- Using a person's voice requires their consent (or that of their representative).

## Licenses

| Component | License |
|---|---|
| Sguardo code | [GNU AGPL-3.0](LICENSE) |
| MediaPipe Face Landmarker (loaded by the browser) | Apache 2.0 |
| `data/parole-it.txt` (from FrequencyWords) | CC BY-SA 4.0, see `data/LICENSE-parole-it.txt` |
| `data/words-en.txt` (from FrequencyWords) | CC BY-SA 4.0, see `data/LICENSE-words-en.txt` |
| `data/words-es.txt` (from FrequencyWords) | CC BY-SA 4.0, see `data/LICENSE-words-es.txt` |
| `data/words-fr.txt` (from FrequencyWords) | CC BY-SA 4.0, see `data/LICENSE-words-fr.txt` |
| `data/words-de.txt` (from FrequencyWords) | CC BY-SA 4.0, see `data/LICENSE-words-de.txt` |
| `data/words-pt.txt` (from FrequencyWords) | CC BY-SA 4.0, see `data/LICENSE-words-pt.txt` |
| coqui-tts (installed separately) | MPL-2.0 |
| XTTS-v2 model (downloaded separately) | [Coqui Public Model License](https://coqui.ai/cpml): **non-commercial use only** |

The XTTS-v2 model is not in the repository: whoever uses it accepts its license from the page.

Copyright (C) 2026 Paolo De Luise. Sguardo is free software: you can redistribute it and modify it
under the terms of the GNU Affero General Public License version 3. In short: whoever distributes
a modified version, or offers it as an online service, must make the source code available
under the same license. The license covers the Sguardo code; the components listed
above keep their own (in particular the XTTS-v2 voice remains for non-commercial use only).

## Development

**Improving accuracy with real data.** After a full calibration, **View errors** shows
where the person was looking and where the system estimated the gaze; **Save data** writes the
calibration and the archive to `recordings/`. **Last result** reopens the result as long as the page stays open.

```
node tools/evaluate.mjs          # algorithm error on all the recordings
node tools/evaluate-drift.mjs    # error after a posture change
node tools/test-posture.mjs      # posture check and archive
node tools/test-predictor.mjs    # word suggestion
node tools/test-calibration.mjs  # labels of the data collected with the moving dot
node tools/test-modes.mjs        # eyes / head / eyes + head modes, with synthetic data
node tools/evaluate.mjs --modes  # the three modes on the same recordings
node tools/test-recognizer.mjs   # drawn letters, synthetic drawings (--tune for the weights; slow)
node tools/test-words.mjs        # drawn words: letter separation and dictionary choice
node tools/test-draw-pen.mjs     # pen: preparation, side cell, lifting when still, point cutting (simulated pointer)
node tools/test-gestures.mjs     # pen gestures (wink, open mouth) with simulated frames
node tools/test-i18n.mjs         # interface languages: same keys and placeholders, keyboard, word lists
node tools/simulate-dasher.mjs   # continuous writing with a simulated gaze (error ~100 px)
node tools/simulate-dwell.mjs    # cell selection with a simulated gaze, PC and phone
```

Every change to `js/features.js`, `js/regression.js` or `js/pool.js` should be compared across several
recordings, not just one: posture and light change from one session to the next.

| File | What it does |
|---|---|
| `index.html`, `css/style.css` | Page and style |
| `js/main.js` | Ties everything together: screens, calibration, voice, settings |
| `js/i18n.js` | Translations: loading, language choice, `t()` |
| `js/locales/` | One file per language |
| `js/tracker.js` | Camera + MediaPipe Face Landmarker |
| `js/features.js` | Features for each control mode: iris, eyelid, blendshapes, head pose |
| `js/regression.js` | (Weighted) ridge regression from the features to the position on the screen |
| `js/calibration.js` | Calibration and verification points, sliding dot, sample cleaning |
| `js/pool.js` | Archive of calibrations, weighted by posture similarity |
| `js/posture.js` | Detects posture changes relative to the last calibration |
| `js/filter.js` | One Euro filter to stabilize the point |
| `js/board.js` | Grid of cells with fixation selection |
| `js/dwell.js` | Cell choice: accumulation of evidence from the gaze (also in the simulator) |
| `js/keyboard.js` | Two-step keyboard (letter groups and quick phrases come from the language), personal phrases |
| `js/predictor.js` | Word suggestion: frequencies of the spoken language + words used by the person |
| `js/dasher.js` | Continuous writing |
| `js/draw.js` | Handwriting: drawing area, pen (lowered by a gesture or a cell, lifted by the gesture or by staying still), end of drawing |
| `js/gestures.js` | Gestures that lower the pen: wink and open mouth, with level and threshold |
| `js/recognizer.js` | Drawn letters ($P), separation into letters, words from the dictionary, learned letters |
| `js/voice.js` | Cloned voice in the page (requests to `serve.py`, phrase memory) |
| `serve.py` | Local server: files, voice, recordings; `--https` for the phone |
| `voice.py` | Voice cloning and generation with XTTS-v2 |
| `data/parole-it.txt` | 30,000 Italian words by frequency |
| `data/words-en.txt` | English words by frequency |
| `data/words-es.txt` | Spanish words by frequency |
| `data/words-fr.txt` | French words by frequency |
| `data/words-de.txt` | German words by frequency |
| `data/words-pt.txt` | Portuguese (Brazil) words by frequency |
| `tools/` | Evaluations and tests (Node.js) |

## Languages

The interface is available in Italian, English, Spanish, French, German and Portuguese (Brazil). The language is chosen automatically from the
browser language and can be changed from the start screen or from the assistant toolbar (the page
reloads). What the person teaches Sguardo — learned words and saved phrases — is kept separately
for each language. The cloned voice is the same in every language and speaks the language you
choose (XTTS-v2 supports 17 languages: English, Spanish, French, German, Italian, Portuguese,
Polish, Turkish, Russian, Dutch, Czech, Arabic, Chinese, Japanese, Hungarian, Korean, Hindi).

To add a language you need two things:

- a file `js/locales/<code>.js` with the interface texts, the quick phrases, the keyboard and the
  voice codes;
- a list of words by frequency in `data/`, with its license.

Every language has its own word list in `data/` (`parole-it.txt`, `words-en.txt`, `words-es.txt`,
`words-fr.txt`, `words-de.txt`, `words-pt.txt`), all from FrequencyWords (CC BY-SA 4.0, see the
`data/LICENSE-words-*.txt` files).

Known limits of the languages added so far: **German** shows nouns in lowercase (the word list has
no capital letters; only the start of a sentence is capitalized); **French** treats the apostrophe
like Italian (`l'` + `homme`), **English** keeps it inside the word (`don't`); **Portuguese** is the
Brazilian variant; the contractions in the English list were rebuilt from fragments, so their order
is approximate.

To add a language, copy `js/locales/en.js` to `js/locales/<code>.js`, translate it and register it in
`js/i18n.js`; then add the word list and run `node tools/test-i18n.mjs`, which checks that every
text exists with the same placeholders, that the keyboard has all 26 letters and that the word
list works with the language rules (for example whether the apostrophe is part of a word, as in
English «don't», or ends it, as in Italian «l'acqua»). Languages with the Latin alphabet work
as they are: handwriting recognizes the letters A–Z and the suggestions ignore accents.
Other alphabets need a different recognizer and keyboard.

Have the quick phrases (needs such as pain, bathroom, help) and the interface texts checked by a
native speaker before relying on them: a mistake there is not just a typo.

## Next steps

- Next-word suggestion even without a personal history (today, mid-sentence, it offers
  only frequent words).
- A faster voice for slow PCs (the cloned voice uses XTTS-v2, a non-commercial license).
- The ability to use Sguardo without an internet connection (MediaPipe and the face model stored locally).

Reports and proposals are welcome in the
[repository Issues](https://github.com/PaoloDeLuise/sguardo/issues), especially from those who use
Sguardo every day or care for someone who does.
