// Voce clonata, generata da serve.py (voice.py). Se il server non la offre, Sguardo usa la
// sintesi vocale del browser.

const MAX_CACHED = 60;

export class ClonedVoice {
  constructor() {
    this.status = null;
    this.cache = new Map(); // testo -> Promise<URL dell'audio>
    this.player = new Audio();
    this.urgent = 0; // richieste della persona in corso: la preparazione in background aspetta
  }

  get ready() {
    return Boolean(this.status?.installed && this.status?.license && this.status?.cloned);
  }

  async refresh() {
    try {
      const res = await fetch("/api/voice");
      this.status = res.ok ? await res.json() : null;
    } catch {
      this.status = null;
    }
    return this.status;
  }

  async upload(file) {
    this.status = await post(`/api/voice/sample?name=${encodeURIComponent(file.name)}`, file);
  }

  async acceptLicense() {
    this.status = await post("/api/voice/license");
  }

  async clone() {
    const result = await post("/api/voice/clone");
    this.status = result;
    this.cache.clear();
    return result;
  }

  async reset() {
    this.status = await post("/api/voice/reset");
    this.cache.clear();
  }

  // L'audio di ogni frase si genera una volta sola.
  // keep: da conservare per sempre sul PC (frasi rapide); le altre restano solo per un po'.
  audioFor(text, keep = false) {
    if (!this.cache.has(text)) {
      const pending = fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, keep }),
      }).then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
        return URL.createObjectURL(await res.blob());
      });
      pending.catch(() => this.cache.delete(text));
      this.cache.set(text, pending);
      // Si tengono le ultime frasi (le frasi rapide sono le prime e vengono richieste spesso).
      while (this.cache.size > MAX_CACHED) {
        const [oldest, url] = this.cache.entries().next().value;
        this.cache.delete(oldest);
        url.then((u) => URL.revokeObjectURL(u), () => {});
      }
    } else {
      // Usata di nuovo: diventa la più recente.
      const url = this.cache.get(text);
      this.cache.delete(text);
      this.cache.set(text, url);
    }
    return this.cache.get(text);
  }

  async play(text) {
    this.urgent++;
    try {
      this.player.src = await this.audioFor(text);
    } finally {
      this.urgent--;
    }
    await this.player.play();
  }

  // Prepara in anticipo le frasi rapide, una alla volta per non bloccare il server.
  async prefetch(texts) {
    for (const t of texts) {
      // Il server genera una frase alla volta: se la persona sta aspettando una frase, si cede il passo.
      while (this.urgent > 0) await new Promise((r) => setTimeout(r, 200));
      try {
        await this.audioFor(t, true);
      } catch {
        return;
      }
    }
  }
}

async function post(path, body) {
  const res = await fetch(path, { method: "POST", body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
