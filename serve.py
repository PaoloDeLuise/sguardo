r"""Server locale per provare Sguardo.

    python serve.py           -> http://localhost:8000 (solo questo PC)
    python serve.py --https   -> https://<ip-del-pc>:8443 (anche dal telefono sulla stessa Wi-Fi)

La fotocamera nel browser funziona solo su localhost o in HTTPS: con --https viene
generato un certificato autofirmato, quindi il browser mostrerà un avviso da accettare.

Per la voce clonata va avviato con il Python dell'ambiente in cui è installato
requirements-voce.txt (per esempio .venv-voce\Scripts\python serve.py); senza, Sguardo usa la
voce del browser.
"""

import argparse
import datetime
import functools
import http.server
import ipaddress
import json
import pathlib
import socket
import ssl
import sys
import urllib.parse

from voice import VoiceEngine, error_message

ROOT = pathlib.Path(__file__).resolve().parent
CERT_DIR = ROOT / ".cert"
RECORDINGS_DIR = ROOT / "recordings"
MAX_RECORDING_BYTES = 50 * 1024 * 1024
MAX_UPLOAD_BYTES = 30 * 1024 * 1024
MAX_TTS_CHARS = 400
PRIVATE_DIRS = {"voce", "recordings", "tools"}
# Operazioni che cambiano dati sul PC: solo da questo PC, mai dalla rete locale.
LOCAL_ONLY = {"/api/recording", "/api/voice/sample", "/api/voice/clone", "/api/voice/license", "/api/voice/reset"}

voice = VoiceEngine()


class Handler(http.server.SimpleHTTPRequestHandler):
    # Su Windows il registro può associare .js a un tipo sbagliato e bloccare i moduli ES.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()")
        self.send_header("X-Frame-Options", "DENY")
        super().end_headers()

    def do_GET(self):
        if self.path == "/api/voice":
            if self.check_api():
                self.send_json({**voice.status(), "local": self.is_local()})
        elif self.is_private():
            self.send_error(404)
        else:
            super().do_GET()

    def do_HEAD(self):
        if self.is_private():
            self.send_error(404)
        else:
            super().do_HEAD()

    # Dati personali e file locali non vanno mai serviti, nemmeno sulla rete locale con --https.
    # Si controlla il percorso già risolto, così "/js/../voce" non aggira il blocco.
    def is_private(self):
        target = pathlib.Path(self.translate_path(self.path)).resolve()
        try:
            parts = target.relative_to(ROOT).parts
        except ValueError:
            return True
        return bool(parts) and (parts[0].lower() in PRIVATE_DIRS or parts[0].startswith("."))

    def is_local(self):
        return ipaddress.ip_address(self.client_address[0]).is_loopback

    # Le API rispondono solo alla pagina di Sguardo:
    # - Host atteso: blocca il "DNS rebinding" (un sito che si fa risolvere in 127.0.0.1);
    # - Origin, se c'è, uguale al server: blocca le richieste partite da altri siti (CSRF);
    # - intestazione X-Sguardo sulle richieste che cambiano qualcosa: un altro sito non può
    #   aggiungerla senza un permesso (CORS) che questo server non concede mai;
    # - le operazioni che modificano dati sul PC solo da questo PC.
    def check_api(self, path=None):
        host = (self.headers.get("Host") or "").lower()
        hostname = urllib.parse.urlsplit(f"//{host}").hostname or ""
        origin = self.headers.get("Origin")
        if hostname not in self.server.allowed_hosts:
            reason = "Host non consentito."
        elif origin and urllib.parse.urlsplit(origin).netloc.lower() != host:
            reason = "Richiesta da un altro sito."
        elif self.command == "POST" and self.headers.get("X-Sguardo") != "1":
            reason = "Richiesta non valida."
        elif path in LOCAL_ONLY and not self.is_local():
            reason = "Si può fare solo dal PC su cui gira Sguardo."
        else:
            return True
        self.send_json({"error": reason}, 403)
        return False

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        if not self.check_api(url.path):
            return
        try:
            if url.path == "/api/recording":
                self.save_recording()
            elif url.path == "/api/voice/sample":
                name = urllib.parse.parse_qs(url.query).get("name", ["vocale"])[0]
                saved = voice.add_sample(name, self.read_body(MAX_UPLOAD_BYTES))
                self.send_json({"saved": saved, **voice.status()})
            elif url.path == "/api/voice/clone":
                seconds = voice.clone()
                self.send_json({"seconds": round(seconds, 1), **voice.status()})
            elif url.path == "/api/voice/license":
                voice.accept_license()
                self.send_json(voice.status())
            elif url.path == "/api/voice/reset":
                voice.reset()
                self.send_json(voice.status())
            elif url.path == "/api/tts":
                request = json.loads(self.read_body(10_000))
                text = request.get("text", "").strip()[:MAX_TTS_CHARS]
                if not text:
                    raise ValueError("Testo vuoto.")
                audio = voice.synthesize(text, keep=bool(request.get("keep")), language=str(request.get("lang", "")))
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(audio)))
                self.end_headers()
                self.wfile.write(audio)
            else:
                self.send_error(404)
        except ValueError as e:
            # La lingua dell'interfaccia arriva in X-Sguardo-Lang: gli errori della voce si traducono.
            self.send_json({"error": error_message(e, self.headers.get("X-Sguardo-Lang", "it"))}, 400)
        except Exception as e:  # noqa: BLE001 - l'errore viene mostrato nella pagina
            self.send_json({"error": f"{type(e).__name__}: {e}"}, 500)

    def read_body(self, limit):
        length = int(self.headers.get("Content-Length", 0))
        if not 0 < length <= limit:
            raise ValueError("Richiesta vuota o troppo grande.")
        return self.rfile.read(length)

    def send_json(self, data, status=200):
        reply = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(reply)))
        self.end_headers()
        self.wfile.write(reply)

    # Salva le registrazioni di calibrazione in recordings/ per l'analisi offline.
    def save_recording(self):
        body = self.read_body(MAX_RECORDING_BYTES)
        try:
            json.loads(body)
        except ValueError:
            raise ValueError("JSON non valido") from None
        RECORDINGS_DIR.mkdir(exist_ok=True)
        name = datetime.datetime.now().strftime("calibrazione-%Y%m%d-%H%M%S.json")
        (RECORDINGS_DIR / name).write_bytes(body)
        self.send_json({"file": f"recordings/{name}"})


class Server(http.server.ThreadingHTTPServer):
    allowed_hosts = {"localhost", "127.0.0.1", "::1"}

    # Il browser chiude le richieste in corso quando la pagina viene ricaricata: non è un errore.
    def handle_error(self, request, client_address):
        if isinstance(sys.exc_info()[1], (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # nessun pacchetto inviato, serve solo a scegliere l'interfaccia
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def make_cert(ip):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    CERT_DIR.mkdir(exist_ok=True)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "sguardo-local")])
    now = datetime.datetime.now(datetime.timezone.utc)
    san = x509.SubjectAlternativeName([
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
        x509.IPAddress(ipaddress.ip_address(ip)),
    ])
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(san, critical=False)
        .sign(key, hashes.SHA256())
    )
    key_path, cert_path = CERT_DIR / "key.pem", CERT_DIR / "cert.pem"
    key_path.write_bytes(key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    ))
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return cert_path, key_path


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--https", action="store_true", help="HTTPS sulla rete locale, per il telefono")
    parser.add_argument("--port", type=int)
    args = parser.parse_args()

    handler = functools.partial(Handler, directory=str(ROOT))
    if args.https:
        ip = lan_ip()
        port = args.port or 8443
        server = Server(("0.0.0.0", port), handler)
        server.allowed_hosts = Server.allowed_hosts | {ip}
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(*make_cert(ip))
        server.socket = ctx.wrap_socket(server.socket, server_side=True)
        print(f"Apri dal telefono:  https://{ip}:{port}")
        print(f"Oppure da qui:      https://localhost:{port}")
        print("Il certificato è autofirmato: accetta l'avviso del browser.")
        print("Dalla rete locale la voce clonata si può usare ma non modificare (vocali, clonazione: solo da questo PC).")
    else:
        port = args.port or 8000
        server = Server(("127.0.0.1", port), handler)
        print(f"Apri:  http://localhost:{port}")

    status = voice.status()
    if not status["installed"]:
        print("Voce clonata: non disponibile (installa requirements-voce.txt e ffmpeg). Si usa la voce del browser.")
    elif status["cloned"] and status["license"]:
        print("Voce clonata: carico il modello in background…")
        voice.load_in_background()
    else:
        print("Voce clonata: disponibile, nessuna voce ancora clonata.")
    print("Ctrl+C per fermare.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
