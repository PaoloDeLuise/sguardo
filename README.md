# Sguardo

Scrivere e parlare con gli occhi usando una normale webcam, da PC o telefono.
Pensato per persone che non possono muoversi né parlare (per esempio con SLA), e per chi le assiste.

- **Tracciamento dello sguardo nel browser** con MediaPipe Face Landmarker: il video della
  fotocamera non lascia mai il dispositivo.
- **Tastiera a due passaggi** con suggerimento delle parole, **frasi rapide** e frasi personali,
  **scrittura continua** (alla Dasher) come alternativa.
- **Voce clonata** (facoltativa) dalla voce della persona, con pochi vocali o una registrazione,
  generata sul PC senza servizi esterni.
- Si usa tutto con gli occhi: selezione fissando una cella, menu chiudendo gli occhi per 2 secondi,
  ricalibrazione automatica quando la persona cambia postura.

## Cosa serve

| Per | Serve |
|---|---|
| Usare Sguardo | Un browser recente (Chrome, Edge, Firefox, Safari) e una webcam qualsiasi, anche quella del portatile o del telefono |
| Avviarlo sul proprio PC | [Python](https://www.python.org/downloads/) 3.10–3.13 (provato con 3.12), solo per servire i file |
| La voce clonata (facoltativa) | Python 3.10–3.13, [ffmpeg](https://ffmpeg.org/download.html), circa 4 GB di spazio (librerie + modello), un PC qualsiasi: non serve una scheda grafica |
| Gli strumenti di analisi (facoltativi) | [Node.js](https://nodejs.org/) 20 o successivo |

**Python non è obbligatorio.** La parte che segue gli occhi, la tastiera e i suggerimenti è una
pagina web statica: funziona con qualunque server di file, per esempio GitHub Pages, e in quel
caso usa la voce del browser. Python serve solo per avviarla sul proprio PC con `serve.py` e per
la voce clonata.

## Installazione

```
git clone https://github.com/PaoloDeLuise/sguardo.git
cd sguardo
```

(oppure scarica lo ZIP del repository e decomprimilo).

### Solo tracciamento e tastiera

Non c'è niente da installare: basta Python.

```
python serve.py
```

e apri **http://localhost:8000**. Su macOS e Linux il comando può essere `python3`.

### Con la voce clonata

1. Installa ffmpeg:
   - Windows: `winget install Gyan.FFmpeg` (poi riapri il terminale)
   - macOS: `brew install ffmpeg`
   - Linux (Debian/Ubuntu): `sudo apt install ffmpeg`
2. Crea un ambiente Python separato e installa le dipendenze (circa 1,5 GB):

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
3. Apri **http://localhost:8000**. Nella sezione **Voce** della schermata iniziale:
   1. accetta la licenza del modello XTTS-v2 (solo uso non commerciale, vedi [Licenze](#licenze)):
      solo allora il modello (circa 1,8 GB) viene scaricato, una volta sola;
   2. scegli 10–30 secondi di vocali della persona (vanno bene quelli di WhatsApp) oppure
      premi **Registra** e leggi il testo proposto;
   3. premi **Clona la voce**, poi prova una frase con **Ascolta**.

   Più vocali puliti rendono il timbro più stabile (fino a circa 30 secondi migliora anche
   l'intonazione). I campioni si sommano: **Elimina voce** riparte da zero.

Da quel momento `serve.py` va avviato sempre con il Python di `.venv-voce`.

## Dal telefono o dal tablet

La fotocamera nel browser funziona solo da `localhost` o in **HTTPS**. Tre modi:

1. **Sito pubblicato (il più semplice, senza voce clonata).** Pubblica il repository con
   GitHub Pages (*Settings → Pages → Deploy from a branch → main*) e apri l'indirizzo dal telefono.
   GitHub Pages è gratuito per i repository pubblici.
2. **Dal PC sulla stessa Wi-Fi (anche con la voce clonata).** Serve il pacchetto `cryptography`
   per creare il certificato (già incluso se hai installato la voce):
   ```
   python -m pip install -r requirements.txt
   python serve.py --https
   ```
   stampa un indirizzo `https://<ip-del-pc>:8443` da aprire sul telefono. Il certificato è
   autofirmato: il browser mostra un avviso da accettare. Se il telefono non raggiunge il PC:
   - Windows blocca le connessioni in entrata sulle reti "pubbliche": imposta la Wi-Fi come rete
     privata, oppure consenti Python nel firewall;
   - alcune reti (aziendali, ospiti) isolano i dispositivi tra loro: in quel caso usa il modo 3.

   Dal telefono la voce clonata si usa, ma si prepara e si modifica solo dal PC.
3. **Tunnel HTTPS** (per esempio `cloudflared tunnel --url http://localhost:8000`): funziona da
   qualunque rete, ma rende la pagina raggiungibile da internet finché il tunnel è aperto.

Sugli schermi piccoli la barra per chi assiste si nasconde (si riapre con ⚙), in verticale la
griglia diventa 3×4 e la scrittura continua mette le lettere sul lato lungo dello schermo.
Un tablet resta più comodo: celle più grandi rispetto all'errore dello sguardo.
Sul telefono lo sfondo è chiaro: lo schermo vicino al viso lo illumina, la fotocamera amplifica
meno il segnale e i punti del viso sono meno rumorosi. Dal menu: **Sfondo automatico / chiaro /
scuro** (cambiandolo conviene ricalibrare, perché cambia la luce sul viso).

Il telefono va fissato su un supporto, all'altezza degli occhi, e non va tenuto in mano: ogni
spostamento del telefono cambia la stima come uno spostamento della testa. Verticale e
orizzontale hanno calibrazioni separate: girando il telefono parte da sola la ricalibrazione
(completa la prima volta, rapida le successive). Anche quando la finestra cambia dimensione
(la barra degli indirizzi che compare, lo schermo intero che si chiude) Sguardo propone di
ricalibrare. Accanto alla miniatura della fotocamera si vedono i fotogrammi al secondo: sotto
15 circa lo sguardo trema di più.

## Uso

Chi assiste preme **Avvia fotocamera** una volta (il browser lo richiede). Da lì in poi tutto si fa
con gli occhi.

1. **Calibrazione.** La prima volta si segue con gli occhi il punto che scivola da una posizione
   all'altra, fissandolo quando si ferma (circa 50 secondi). Le volte successive basta una
   **ricalibrazione rapida** di 10 secondi: il modello usa anche le calibrazioni salvate, pesate per
   quanto la loro postura somiglia a quella di adesso. Alla fine si sceglie **Continua** o
   **Ricalibra** fissando la cella (dopo 10 secondi si prosegue da soli).
2. **Tastiera.** Si fissa un gruppo di lettere (1 secondo), poi la lettera.
   - La prima riga propone tre parole; i suggerimenti imparano dalle frasi della persona.
   - **Parla** legge la frase; a testo vuoto diventa **Ripeti**.
   - **Cancella** toglie una lettera; continuando a guardarla toglie una parola intera ogni 1,5 s.
   - Numeri e punteggiatura: gruppo **Z J K W X Y / . , ? 123**, poi **123**.
3. **Frasi.** Dieci frasi per i bisogni (Sì, No, Aiuto, Acqua, Dolore...). In **Le mie frasi** si
   salva l'ultima frase detta (**Salva**) e si tolgono quelle non più utili.
4. **Menu: occhi chiusi per 2 secondi.** Ricalibrare, tempo di fissazione, punto visibile,
   **scrittura continua**: le lettere arrivano dall'alto, affiancate e grandi quanto sono probabili;
   si guarda in alto, verso la lettera voluta, per avanzare e in basso per tornare indietro (e
   cancellare). Dal menu si può passare alla versione verticale (lettere da destra).
5. **Cambio di postura.** Se la testa resta spostata o inclinata per più di 3 secondi compare un
   avviso e dopo 5 secondi parte la ricalibrazione rapida. **Non ora** la rimanda di 3 minuti.

I battiti di ciglia normali non interrompono la fissazione, e nemmeno il tremolio dello sguardo:
ogni cella accumula "prove" quando lo sguardo ci cade vicino e le perde lentamente quando non la
si guarda, quindi un'uscita breve non fa ripartire da zero. Mentre si guarda si vedono riempirsi
le celle candidate; quella in vantaggio è evidenziata.

**Per chi assiste:**

- clic su un punto mentre la persona lo guarda = un punto di calibrazione in più (cerchio verde;
  grigio se l'occhio si stava muovendo). Il clic destro calibra senza selezionare nulla;
- tasti: `C` calibrazione completa, `R` rapida, `M` menu, `D` scrittura continua, `P` punto,
  `Esc` interrompe la calibrazione;
- **Nuova persona** cancella le calibrazioni salvate (quando Sguardo passa a un'altra persona);
- `http://localhost:8000/?mouse`: il mouse fa le veci dello sguardo, per provare senza fotocamera.

### Tempi della voce clonata

Misurati su un portatile i7-1255U senza scheda grafica: avvio del modello 18 s (una volta),
clonazione 1–2 s, frase breve 3–5 s, in generale circa 2,5 volte la durata della frase. Su PC più
lenti i tempi crescono in proporzione. Per non far aspettare la persona:

- le frasi rapide e quelle salvate sono generate una volta e conservate (poi partono in 0,2 s);
- mentre la persona scrive, la frase viene preparata a ogni parola finita;
- il modello è compresso a 8 bit (circa 30% più veloce; `SGUARDO_INT8=0` lo disattiva);
- se la voce clonata non risponde si usa la voce del browser.

## Privacy e sicurezza

- **Video:** elaborato solo nel browser; non viene salvato né inviato.
- **Dati salvati nel browser** (`localStorage`): calibrazioni, impostazioni, parole e frasi della
  persona. **Nuova persona** cancella le calibrazioni; i dati del sito si cancellano dalle
  impostazioni del browser.
- **Dati salvati sul PC** (solo con `serve.py`): `voce/` (vocali, voce clonata, frasi generate;
  quelle scritte restano solo le ultime 100) e `recordings/` (calibrazioni salvate con **Salva dati**,
  contengono i punti del viso). Entrambe le cartelle sono escluse dal repository e `serve.py` non
  le serve mai.
- **Connessioni esterne:** solo per scaricare MediaPipe (jsDelivr), il modello del viso (Google) e,
  una volta, il modello della voce. La pagina ha una Content Security Policy che non permette altro.
- **`serve.py`:** accetta richieste solo dalla pagina di Sguardo (controllo di `Host` e `Origin` e
  intestazione `X-Sguardo`, contro richieste da altri siti e DNS rebinding). Le operazioni che
  modificano dati (vocali, clonazione, registrazioni) sono permesse solo dal PC stesso. È un server
  pensato per uso personale, non per essere esposto su internet.
- Usare la voce di una persona richiede il suo consenso (o quello di chi la rappresenta).

## Licenze

| Componente | Licenza |
|---|---|
| Codice di Sguardo | [GNU AGPL-3.0](LICENSE) |
| MediaPipe Face Landmarker (caricato dal browser) | Apache 2.0 |
| `data/parole-it.txt` (da FrequencyWords) | CC BY-SA 4.0, vedi `data/LICENSE-parole-it.txt` |
| coqui-tts (installata a parte) | MPL-2.0 |
| Modello XTTS-v2 (scaricato a parte) | [Coqui Public Model License](https://coqui.ai/cpml): **solo uso non commerciale** |

Il modello XTTS-v2 non è nel repository: chi lo usa ne accetta la licenza dalla pagina.

Copyright (C) 2026 Paolo De Luise. Sguardo è software libero: puoi ridistribuirlo e modificarlo
secondo i termini della GNU Affero General Public License versione 3. In breve: chi distribuisce
una versione modificata, o la offre come servizio online, deve renderne disponibile il codice
sorgente con la stessa licenza. La licenza riguarda il codice di Sguardo; i componenti elencati
sopra mantengono le loro (in particolare la voce XTTS-v2 resta solo per uso non commerciale).

## Sviluppo

**Migliorare la precisione con dati reali.** Dopo una calibrazione completa, **Vedi errori** mostra
dove si guardava e dove il sistema stimava lo sguardo; **Salva dati** scrive in `recordings/` la
calibrazione e l'archivio. **Ultimo risultato** riapre il risultato finché la pagina resta aperta.

```
node tools/evaluate.mjs          # errore dell'algoritmo su tutte le registrazioni
node tools/evaluate-drift.mjs    # errore dopo un cambio di postura
node tools/test-posture.mjs      # controllo della postura e archivio
node tools/test-predictor.mjs    # suggerimento delle parole
node tools/test-calibration.mjs  # etichette dei dati raccolti con il punto in movimento
node tools/simulate-dasher.mjs   # scrittura continua con uno sguardo simulato (errore ~100 px)
node tools/simulate-dwell.mjs    # selezione delle celle con uno sguardo simulato, PC e telefono
```

Ogni modifica a `js/features.js`, `js/regression.js` o `js/pool.js` va confrontata su più
registrazioni, non su una sola: tra una sessione e l'altra cambiano postura e luce.

| File | Cosa fa |
|---|---|
| `index.html`, `css/style.css` | Pagina e stile |
| `js/main.js` | Collega tutto: schermate, calibrazione, voce, impostazioni |
| `js/tracker.js` | Fotocamera + MediaPipe Face Landmarker |
| `js/features.js` | Caratteristiche dello sguardo: iride, palpebra, blendshape degli occhi, posa della testa |
| `js/regression.js` | Regressione ridge (pesata) dalle caratteristiche alla posizione sullo schermo |
| `js/calibration.js` | Punti di calibrazione e verifica, punto che scivola, pulizia dei campioni |
| `js/pool.js` | Archivio delle calibrazioni, pesato per somiglianza di postura |
| `js/posture.js` | Riconosce i cambi di postura rispetto all'ultima calibrazione |
| `js/filter.js` | Filtro One Euro per stabilizzare il punto |
| `js/board.js` | Griglia di celle con selezione a fissazione |
| `js/dwell.js` | Scelta della cella: accumulo di prove dallo sguardo (anche nel simulatore) |
| `js/keyboard.js` | Tastiera a due passaggi, frasi rapide e personali |
| `js/predictor.js` | Suggerimento parole: frequenze italiane + parole usate dalla persona |
| `js/dasher.js` | Scrittura continua |
| `js/voice.js` | Voce clonata nella pagina (richieste a `serve.py`, memoria delle frasi) |
| `serve.py` | Server locale: file, voce, registrazioni; `--https` per il telefono |
| `voice.py` | Clonazione e generazione della voce con XTTS-v2 |
| `data/parole-it.txt` | 30.000 parole italiane per frequenza |
| `tools/` | Valutazioni e prove (Node.js) |

## Prossimi passi

- Suggerimento della parola successiva anche senza storico personale (oggi a metà frase propone
  solo parole frequenti).
- Una voce più veloce per i PC lenti (la voce clonata usa XTTS-v2, licenza non commerciale).
- Possibilità di usare Sguardo senza connessione a internet (MediaPipe e modello del viso in locale).

Segnalazioni e proposte sono benvenute nelle
[Issue del repository](https://github.com/PaoloDeLuise/sguardo/issues), soprattutto da chi usa
Sguardo ogni giorno o assiste chi lo usa.
