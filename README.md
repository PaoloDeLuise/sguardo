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
5. **Scrittura a mano** (menu → *Scrittura a mano*, o **Scrivi a mano** nella barra, o il tasto `H`):
   il puntatore disegna una lettera o una parola intera. Pensata per la modalità con la testa, ma
   vale per tutte. Si attiva solo quando la si sceglie: non cambia nulla per chi usa la tastiera.
   - **Penna:** un puntatore non ha pulsante, quindi la penna si abbassa e si alza in uno di cinque
     modi, a scelta nel menu (*Scrittura a mano* → *Penna*; il livello di ogni gesto si vede in
     una barra in fondo al disegno, oltre il segno scatta):
     - **occhiolino** (predefinito): un occhio chiuso per un istante (0,15 s); un battito con tutti
       e due gli occhi non conta;
     - **bocca aperta**: la mandibola è indipendente dal puntatore e il segnale è forte anche con
       la fotocamera del telefono;
     - **inclinare la testa** di lato (circa 15°) e tornare dritti, da una parte o dall'altra; la
       posizione "dritta" segue lentamente la testa, quindi non serve tenerla perfettamente ferma;
     - **cella accanto**: si fissa la cella **Penna** e la preparazione parte da quando il
       puntatore **rientra** nell'area di disegno. A penna giù, uscire dall'area la alza (e di
       nuovo la cella per il tratto dopo): è il modo più lento, ma non chiede nessun gesto;
     - **da fermo**: si sta fermi per circa 0,7 secondi (un cerchio si riempie attorno al
       puntatore). Dopo ogni cambio bisogna muoversi prima di poter cambiare ancora, quindi
       restare fermi a penna alzata per finire non scrive niente.

     **Preparazione:** con i tre gesti e con la cella la penna non scende all'istante: per 0,8
     secondi (regolabile nel menu) compare un puntatore fantasma con un cerchio che si riempie, ci
     si posiziona con calma e la penna scende alla fine, dove si trova il puntatore. Ripetere il
     gesto durante la preparazione la annulla. Alzare la penna col gesto vale subito, e gli
     ultimi istanti del tratto, mossi dal gesto, si tolgono. Mentre si fa il gesto il puntatore
     resta fermo. La **soglia** dei gesti si regola nel menu (*Gesto più facile / più difficile*):
     sul telefono i segnali sono più rumorosi che sul portatile.

     **Alzare la penna senza rovinare il tratto:** mentre si fa il gesto, o si esce dall'area, il
     puntatore continua a seguire la testa e disegnerebbe ciò che non si vuole. Quindi, alzando la
     penna, si tolgono dal tratto i punti disegnati *da quando il gesto è cominciato* (non solo
     da quando è scattato: un'inclinazione lenta trascina il puntatore per mezzo secondo) e, con
     la cella, il percorso di uscita: il tratto torna all'ultima **pausa** a fine tratto. Per
     questo, prima di andare alla cella, **fermati un attimo dove il tratto finisce**; se non c'è
     una pausa si tolgono solo gli ultimi istanti.

     A penna alzata il puntatore si muove senza lasciare segno; uscendo dall'area di disegno la
     penna si alza da sola.
   - **Lettera o parola:** si scrivono **lettere staccate in fila da sinistra a destra**. Le lettere
     si separano da sole dalla posizione (la barra della E o il puntino della I restano con la
     loro lettera), in qualunque ordine di tratti. Una lettera sola si aggiunge alla parola in
     corso; più lettere sono una parola e si scrivono con lo spazio. Le lettere a più tratti (E, F,
     H, T...) si fanno alzando la penna tra un tratto e l'altro.
   - **Fine del disegno:** passata la *pausa tra i disegni* (2 s, regolabile nel menu) dall'ultimo
     tratto si legge tutto e si pulisce l'area.
   - **Riconoscimento:** ogni lettera è confrontata con modelli di lettere ($P), poi la parola
     è scelta nel dizionario usando tutte le lettere insieme (una R storta dentro «casa» diventa A);
     un nome fuori dizionario esce com'è scritto. Una lettera sola è aiutata dal linguaggio (dopo
     «cas» una A è più probabile di una R). Non serve scaricare nulla e gira su qualunque PC
     (circa 25 ms a lettera). **Non legge la scrittura corsiva**, con le lettere attaccate.
   - **Correzioni:** accanto al disegno le celle propongono due parole e, subito dopo un disegno,
     due **alternative** («forse», lettere o parole). Sceglierne una sostituisce ciò che è stato
     scritto e **insegna** quei disegni a Sguardo, che la volta dopo li riconosce meglio (si
     dimenticano dal menu). Accenti, numeri e punteggiatura: dalla **Tastiera**.
   - **Stato della verifica:** provata nell'interfaccia (con il mouse), con disegni sintetici
     deformati (`node tools/test-recognizer.mjs`, `tools/test-words.mjs`) e con un puntatore
     simulato per la penna (`tools/test-draw-pen.mjs`), non ancora con una persona che disegna con
     la testa: la precisione vera dipende dal tremolio del puntatore e si saprà solo provando.
6. **Cambio di postura.** Se la testa resta spostata o inclinata per più di 3 secondi compare un
   avviso e dopo 5 secondi parte la ricalibrazione rapida. **Non ora** la rimanda di 3 minuti.
   (Vale solo con il controllo a occhi: con la testa, muoverla è il comando.)

### Controllo: occhi, testa o occhi + testa

Cosa muove il puntatore si sceglie dalla schermata iniziale, dalla barra per chi assiste o dal menu
con gli occhi (**Controllo**). Ogni modalità ha la sua calibrazione, la sua cartella di
calibrazioni salvate e le sue istruzioni: cambiarla avvia una calibrazione (completa la prima volta,
poi rapida).

| Modalità | Il puntatore segue | Pensata per |
|---|---|---|
| **Occhi** (predefinita) | lo sguardo, con la testa ferma | chi non può muovere altro |
| **Testa** | l'orientamento e la posizione del viso, come un puntatore sul naso | chi muove ancora la testa ma ha occhi stanchi o poco precisi |
| **Occhi + testa** | la testa sposta in modo grossolano, gli occhi rifiniscono | chi ha un po' di entrambi |

- Nella calibrazione il punto va seguito con la testa (o con occhi e testa insieme) e **vanno
  raggiunti anche gli angoli dello schermo**: l'ampiezza del movimento è personale e la impara
  da lì.
- Con la testa la posizione di riposo deriva e il collo si stanca: **Ricentra** (menu) chiede di
  puntare il centro dello schermo per 3 secondi e vi riporta la posizione stimata.
- **Stato della verifica:** le modalità con la testa sono state provate solo con dati sintetici e
  nell'interfaccia, non con persone che muovono la testa. Le registrazioni raccolte finora sono a
  testa ferma, quindi `node tools/evaluate.mjs --modes` non dice nulla sulla modalità "testa" (368 px,
  nessun movimento da cui imparare); mostra invece che aggiungere la posizione della testa agli
  occhi, a testa ferma, non peggiora la stima (104 px contro 103 px dei soli occhi). Per misurarla
  davvero servono calibrazioni fatte muovendo la testa, salvate con **Salva dati**.

I battiti di ciglia normali non interrompono la fissazione, e nemmeno il tremolio dello sguardo:
ogni cella accumula "prove" quando lo sguardo ci cade vicino e le perde lentamente quando non la
si guarda, quindi un'uscita breve non fa ripartire da zero. Mentre si guarda si vedono riempirsi
le celle candidate; quella in vantaggio è evidenziata.

**Per chi assiste:**

- clic su un punto mentre la persona lo guarda = un punto di calibrazione in più (cerchio verde;
  grigio se l'occhio si stava muovendo). Il clic destro calibra senza selezionare nulla;
- tasti: `C` calibrazione completa, `R` rapida, `M` menu, `D` scrittura continua, `H` scrittura a mano, `P` punto,
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
node tools/test-modes.mjs        # modalità occhi / testa / occhi + testa, con dati sintetici
node tools/evaluate.mjs --modes  # le tre modalità sulle stesse registrazioni
node tools/test-recognizer.mjs   # lettere disegnate, disegni sintetici (--tune per i pesi; lento)
node tools/test-words.mjs        # parole disegnate: separazione delle lettere e scelta nel dizionario
node tools/test-draw-pen.mjs     # penna: da fermo, preparazione, cella accanto, taglio di fine tratto (puntatore simulato)
node tools/test-gestures.mjs     # gesti della penna (occhiolino, bocca, inclinazione) con fotogrammi simulati
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
| `js/features.js` | Caratteristiche per ogni modalità di controllo: iride, palpebra, blendshape, posa della testa |
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
| `js/draw.js` | Scrittura a mano: area di disegno, penna (si alza e si abbassa stando fermi), fine disegno |
| `js/gestures.js` | Gesti che muovono la penna: occhiolino, bocca aperta, inclinazione, con livello e soglia |
| `js/recognizer.js` | Lettere disegnate ($P), separazione in lettere, parole dal dizionario, lettere imparate |
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
