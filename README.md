# Sguardo

Comunicare con gli occhi usando una normale webcam, da PC o telefono, senza installare nulla.
Il tracciamento gira nel browser con MediaPipe Face Landmarker: il video non lascia mai il dispositivo.

## Provarlo

Serve Python 3 (solo per servire i file).

```
python serve.py            # su questo PC: http://localhost:8000
python serve.py --https    # anche dal telefono, sulla stessa Wi-Fi
```

La fotocamera nel browser funziona solo su `localhost` o in HTTPS. Con `--https` il
certificato è autofirmato (richiede il pacchetto `cryptography`): sul telefono bisogna
accettare l'avviso del browser.

## Uso

Chi assiste preme **Avvia fotocamera** una volta (il browser lo richiede). Da lì in poi tutto
si fa con gli occhi:

1. La prima volta: calibrazione completa, seguendo con gli occhi il punto che scivola da una
   posizione all'altra e fissandolo quando si ferma (circa 50 secondi). Le volte
   successive basta una **ricalibrazione rapida** di 10 secondi: il modello usa anche le
   calibrazioni salvate su questo dispositivo, pesate per quanto la loro postura somiglia a quella attuale.
2. Dopo la calibrazione completa si sceglie **Continua** o **Ricalibra** fissando la cella;
   dopo 10 secondi si prosegue da soli.
3. Se la persona cambia postura (testa spostata o inclinata per più di 3 secondi), compare un
   avviso e dopo 5 secondi parte la ricalibrazione rapida. Fissando **Non ora** si rimanda di 3 minuti.
4. Chi assiste può aiutare la calibrazione: cliccando un punto mentre la persona lo guarda (clic destro per non selezionare nulla), quel momento diventa un punto di calibrazione (cerchio verde; grigio se l'occhio si stava muovendo).
5. **Occhi chiusi per 2 secondi** aprono il menu: ricalibrare, tempo di fissazione, punto visibile.
   I battiti di ciglia normali non interrompono la fissazione.
3. Si scrive con la tastiera a due passaggi: si fissa un gruppo di lettere (default 1 s), poi la lettera.
   La prima riga propone tre parole; **Parla** legge la frase e la cancella; **Frasi** apre le frasi rapide.
   I suggerimenti imparano dalle frasi pronunciate (salvate solo in questo browser).

Per provare la tastiera senza fotocamera: `http://localhost:8000/?mouse` (il mouse fa le veci dello sguardo).

Tasti per chi assiste: `C` calibrazione completa, `R` rapida, `M` menu, `P` punto, `Esc` interrompe la calibrazione.
Il pulsante **Nuova persona** cancella le calibrazioni salvate: va usato quando Sguardo passa a un'altra persona.

## Voce clonata (facoltativa)

Sguardo può parlare con la voce della persona, ricostruita da pochi vocali (anche quelli di WhatsApp).
Usa [Coqui XTTS-v2](https://huggingface.co/coqui/XTTS-v2) e funziona solo con il processore, senza
scheda grafica. Tutto resta sul PC: nessun audio viene inviato a servizi esterni.

```
python -m venv .venv-voce
.venv-voce\Scripts\python -m pip install -r requirements-voce.txt
.venv-voce\Scripts\python serve.py
```

Serve anche [ffmpeg](https://ffmpeg.org/) nel PATH. Poi, nella schermata iniziale, chi assiste:

1. accetta la licenza del modello (vedi sotto): solo allora il modello (circa 1,8 GB) viene scaricato;
2. sceglie 10–30 secondi di vocali della persona, oppure li registra con **Registra** leggendo il testo proposto, e preme **Clona la voce** (i campioni si sommano: **Elimina voce** per ricominciare);
3. prova una frase con **Ascolta**.

**Tempi** misurati su un portatile i7-1255U senza scheda grafica: avvio del modello 18 s (una volta),
clonazione 1–2 s, generazione circa 2,5 volte la durata della frase (una frase breve in 3–5 s).
Su PC più lenti i tempi crescono in proporzione. Per non far aspettare la persona:

- le frasi rapide vengono generate una volta e conservate in `voce/frasi/fisse/` (poi partono in 0,2 s);
- le altre frasi restano solo in una memoria temporanea (`voce/frasi/recenti/`, le ultime 100, al massimo 15 MB);
- mentre la persona scrive, la frase viene preparata in anticipo a ogni punto o pausa;
- il modello è compresso a 8 bit (circa 30% più veloce); `SGUARDO_INT8=0` lo disattiva.

Se la voce clonata non è disponibile, Sguardo usa la voce del browser.
Usare la voce di una persona richiede il suo consenso (o quello di chi la rappresenta).

## Licenze

| Componente | Licenza |
|---|---|
| Codice di Sguardo | da scegliere prima della pubblicazione |
| MediaPipe Face Landmarker (caricato dal browser) | Apache 2.0 |
| `data/parole-it.txt` (da FrequencyWords) | CC BY-SA 4.0, vedi `data/LICENSE-parole-it.txt` |
| coqui-tts (libreria, installata a parte) | MPL-2.0 |
| Modello XTTS-v2 (scaricato a parte) | [Coqui Public Model License](https://coqui.ai/cpml): **solo uso non commerciale** |

Il modello XTTS-v2 non è incluso nel repository: ogni persona che lo usa ne accetta la licenza dalla pagina.

## Migliorare la precisione con dati reali

Dopo una calibrazione, **Vedi errori** mostra dove si guardava e dove il sistema stimava lo sguardo;
**Salva dati** scrive la registrazione in `recordings/` (serve `serve.py`). Per misurare l'algoritmo
su tutte le registrazioni, con lo stesso codice del browser:

```
node tools/evaluate.mjs
```

Ogni modifica a `js/features.js` o `js/regression.js` va confrontata su più registrazioni,
non su una sola: tra una sessione e l'altra cambiano postura e luce.

## Struttura

| File | Cosa fa |
|---|---|
| `js/tracker.js` | Fotocamera + MediaPipe Face Landmarker |
| `js/features.js` | Caratteristiche dello sguardo: iride, palpebra, blendshape degli occhi, posa della testa |
| `js/calibration.js` | Sequenza dei punti di calibrazione e verifica, pulizia dei campioni |
| `js/regression.js` | Regressione ridge dalle caratteristiche alla posizione sullo schermo |
| `js/filter.js` | Filtro One Euro per stabilizzare il punto |
| `js/pool.js` | Archivio delle calibrazioni: il modello si addestra su tutte le sessioni |
| `js/posture.js` | Riconosce i cambi di postura rispetto all'ultima calibrazione |
| `tools/evaluate-drift.mjs` | Errore dopo un cambio di postura, con e senza correzione rapida |
| `tools/test-posture.mjs` | Prove di postura e archivio sulle registrazioni |
| `tools/test-calibration.mjs` | Prove delle etichette dei dati raccolti con il punto in movimento |
| `js/board.js` | Griglia di celle con selezione a fissazione (dwell) |
| `js/keyboard.js` | Tastiera a due passaggi e frasi rapide |
| `js/predictor.js` | Suggerimento parole: frequenze italiane + parole e coppie usate dalla persona |
| `data/parole-it.txt` | 30.000 parole italiane per frequenza (da FrequencyWords, licenza CC BY-SA 4.0) |
| `tools/test-predictor.mjs` | Prove del suggerimento parole (`node tools/test-predictor.mjs`) |
| `js/main.js` | Collega tutto: schermate, voce, impostazioni |

## Prossimi passi

- Suggerimento della parola successiva anche senza storico personale (oggi a metà frase propone solo parole frequenti)
- Server Python per la voce clonata
