"""
Is the NETWORK slow or stalling, or is it R2? Tests plain HTTPS downloads from
hosts that have nothing to do with Heartfolio.

Standard library only. It touches no database and no R2: it does not import
Django and never reads a credential. Run it INSIDE the api container, because
that is the network path the app actually uses (Docker Desktop adds a virtual
network layer of its own, which is one of the things to rule in or out):

    Get-Content backend\\scripts\\net_probe.py | docker compose exec -T api python -

For each target it prints, separately: DNS lookup, TCP connect, TLS handshake,
time to the first byte, speed, and the LONGEST SILENCE during the download.
That last number is the one that matters for the symptom you describe. A slow
link delivers bytes steadily, just slowly. A stalling path (a packet-size
black hole, a proxy that stops forwarding, a half-working IPv6 route) delivers
a little and then goes quiet for tens of seconds.

Each target is fetched twice: with the system's normal choice of IPv6/IPv4, and
forced to IPv4. A big difference between the two points at IPv6.

Environment (`-e NAME=value` before `api`):

    NET_URLS      comma-separated URLs to test instead of the defaults
    NET_MAX_MB    stop each download after this many MB (default 20)
    NET_SECONDS   stop each download after this many seconds (default 30)

It downloads and throws the bytes away: nothing is saved anywhere.
"""

import os
import socket
import ssl
import statistics
import time
from urllib.parse import urlparse

MAX_BYTES = int(float(os.environ.get("NET_MAX_MB", "20")) * 1_000_000)
MAX_SECONDS = float(os.environ.get("NET_SECONDS", "30"))

DEFAULT_URLS = [
    # Cloudflare's own speed-test endpoint: the same company and edge network
    # as R2, but not R2. Fast here and slow on R2 means R2 specifically.
    f"https://speed.cloudflare.com/__down?bytes={MAX_BYTES}",
    # Two hosts that are not Cloudflare. Slow on all of them means the network.
    "https://ash-speed.hetzner.com/100MB.bin",
    "https://proof.ovh.net/files/10Mb.dat",
]
URLS = [u.strip() for u in os.environ.get("NET_URLS", "").split(",") if u.strip()] or DEFAULT_URLS


def fetch(url, family, label):
    """One timed download. Returns a dict of what was measured."""
    parts = urlparse(url)
    host, secure = parts.hostname, parts.scheme == "https"
    port = parts.port or (443 if secure else 80)
    path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    out = {"label": label, "family": "IPv4 forced" if family else "system default"}

    t = time.perf_counter()
    try:
        infos = socket.getaddrinfo(host, port, family or socket.AF_UNSPEC, socket.SOCK_STREAM)
    except OSError as exc:
        out["error"] = f"DNS failed: {exc}"
        return out
    out["dns"] = time.perf_counter() - t
    out["addr_families"] = sorted({"IPv6" if i[0] == socket.AF_INET6 else "IPv4" for i in infos})

    sock, last = None, None
    t = time.perf_counter()
    for fam, kind, proto, _canon, addr in infos:
        try:
            sock = socket.socket(fam, kind, proto)
            sock.settimeout(10)
            sock.connect(addr)
            out["connected_over"] = "IPv6" if fam == socket.AF_INET6 else "IPv4"
            break
        except OSError as exc:
            last, sock = exc, None
    if sock is None:
        out["error"] = f"could not connect: {last}"
        out["tcp"] = time.perf_counter() - t
        return out
    out["tcp"] = time.perf_counter() - t

    if secure:
        t = time.perf_counter()
        try:
            ctx = ssl.create_default_context()
            sock = ctx.wrap_socket(sock, server_hostname=host)
            out["tls"] = time.perf_counter() - t
            issuer = dict(x[0] for x in sock.getpeercert().get("issuer", ()))
            out["cert_issuer"] = issuer.get("organizationName") or issuer.get("commonName") or "?"
        except ssl.SSLCertVerificationError as exc:
            out["error"] = f"certificate NOT trusted ({exc.verify_message}); something may be intercepting TLS"
            return out
        except OSError as exc:
            out["error"] = f"TLS handshake failed: {exc}"
            out["tls"] = time.perf_counter() - t
            return out

    request = (f"GET {path} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: heartfolio-net-probe\r\n"
               "Accept-Encoding: identity\r\nConnection: close\r\n\r\n").encode()
    start = time.perf_counter()
    sock.sendall(request)
    sock.settimeout(15)

    buf, body, status, first = b"", 0, None, None
    last_chunk = start
    longest_gap, gap_at = 0.0, 0.0
    marks = {1: None, 2: None, 5: None, 10: None, 20: None, 30: None}
    try:
        while True:
            if time.perf_counter() - start > MAX_SECONDS or body >= MAX_BYTES:
                break
            try:
                chunk = sock.recv(65536)
            except socket.timeout:
                out["error"] = "no data for 15s (stalled)"
                break
            now = time.perf_counter()
            if not chunk:
                break
            if first is None:
                first = now - start
            if now - last_chunk > longest_gap:
                longest_gap, gap_at = now - last_chunk, last_chunk - start
            last_chunk = now
            if status is None:
                buf += chunk
                if b"\r\n\r\n" in buf:
                    head, _, rest = buf.partition(b"\r\n\r\n")
                    status = head.split(b"\r\n", 1)[0].decode("latin1")
                    for line in head.split(b"\r\n")[1:]:
                        if line.lower().startswith(b"location:"):
                            out["redirect_to"] = line.split(b":", 1)[1].strip().decode("latin1")[:80]
                    body += len(rest)
            else:
                body += len(chunk)
            for s in marks:
                if marks[s] is None and now - start >= s:
                    marks[s] = body
    finally:
        sock.close()
    elapsed = time.perf_counter() - start
    out.update(status=status, ttfb=first, bytes=body, seconds=elapsed, longest_gap=longest_gap, gap_at=gap_at,
               marks={s: b for s, b in marks.items() if b is not None})
    return out


def ms(x):
    return "-" if x is None else f"{x * 1000:.0f}ms"


def show(r):
    name = f"{r['label']} [{r['family']}]"
    if "dns" not in r:
        print(f"  {name}: {r['error']}")
        return
    line = (f"  {name}: dns {ms(r['dns'])} (finds {'+'.join(r['addr_families'])})  tcp {ms(r.get('tcp'))}"
            f"{' over ' + r['connected_over'] if 'connected_over' in r else ''}")
    if "tls" in r:
        line += f"  tls {ms(r['tls'])}"
    if "cert_issuer" in r:
        line += f"  cert by {r['cert_issuer']}"
    print(line)
    if "bytes" not in r:
        print(f"      {r.get('error', 'no download')}")
        return
    mbps = r["bytes"] / 1e6 / r["seconds"] if r["seconds"] else 0
    print(f"      {r['status']}  first byte {ms(r['ttfb'])}  {r['bytes'] / 1e6:.1f}MB in {r['seconds']:.1f}s = {mbps:.2f}MB/s"
          f"   longest silence {r['longest_gap']:.1f}s (at +{r['gap_at']:.1f}s)")
    if r["marks"]:
        print("      MB received by second: " + "  ".join(f"{s}s:{b / 1e6:.1f}" for s, b in r["marks"].items()))
    if "redirect_to" in r:
        print(f"      redirected to {r['redirect_to']} (not followed; pick a direct URL)")
    if "error" in r:
        print(f"      !! {r['error']}")


print(f"network probe from inside the container  (each download capped at {MAX_BYTES / 1e6:.0f}MB or {MAX_SECONDS:.0f}s)")
results = []
for url in URLS:
    label = urlparse(url).hostname
    print(f"\n{url[:90]}")
    for family in (None, socket.AF_INET):
        r = fetch(url, family, label)
        results.append(r)
        show(r)

# R2's own endpoint, TCP and TLS only (an unsigned request moves no photo, and no credential is read).
r2 = os.environ.get("R2_ENDPOINT_URL", "")
if r2:
    host = urlparse(r2).hostname or ""
    masked = "*." + ".".join(host.split(".")[1:]) if host.count(".") >= 2 else host
    print(f"\nR2 endpoint {masked} (connection only; the account part of the name is hidden)")
    for family in (None, socket.AF_INET):
        r = fetch(r2.rstrip("/") + "/", family, "r2-endpoint")
        r["label"] = "r2-endpoint"
        show(r)

done = [r for r in results if r.get("bytes") and r.get("seconds")]
print("\nSUMMARY")
if done:
    rates = [r["bytes"] / 1e6 / r["seconds"] for r in done]
    gaps = [r["longest_gap"] for r in done]
    print(f"  speed across all downloads: median {statistics.median(rates):.2f}MB/s, slowest {min(rates):.2f}MB/s")
    print(f"  longest silence seen: {max(gaps):.1f}s")
    print("  a pack of 8 photos is about 40-64MB and must arrive in under 50s: it needs roughly 1MB/s or better,")
    print("  with no silence of more than a few seconds.")
    stalled = [r for r in done if r["longest_gap"] > 5]
    if stalled:
        print(f"  STALLS: {len(stalled)} of {len(done)} downloads went quiet for more than 5s")
else:
    print("  no download completed")
