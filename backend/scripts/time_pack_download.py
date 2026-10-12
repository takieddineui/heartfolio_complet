"""
Times a whole-pack download for an N-milestone story against REAL storage.

READ-ONLY. Run it through `manage.py shell` on stdin (PowerShell):

    Get-Content backend\\scripts\\time_pack_download.py | docker compose exec -T api python manage.py shell

(bash: `docker compose exec -T api python manage.py shell < backend/scripts/time_pack_download.py`)

A plain `docker compose exec api` uses `.env.docker`, so this reads the real
Supabase database and the real R2 bucket. Nothing is written:

- Postgres is told `default_transaction_read_only = on` on every connection
  this process opens, and the script proves it by attempting a write first.
- The story is built IN MEMORY from a real paid order and that customer's own
  uploaded photos. Nothing is saved, and the archive is read and discarded.
- Telegram alerts are muted, so a failed render here cannot page anyone.
- R2 is only read: HEAD (size) and GET (download). Never PUT or DELETE.

It prints which order it picked (first 8 characters of ids only).

THREE MODES, chosen with `-e MODE=...` (before `api`):

    timing  (default)  the pack download, timed. Prints each photo's size first.
    probe              NO rendering. Measures R2 itself from this machine: the
                       round-trip latency, then how fast ONE photo downloads
                       (time to first byte vs throughput), then all of the
                       story's photos at once the way the pack does. Use it to
                       tell "R2 is slow from here" from "the pack is doing
                       something wrong".
    survey             NO rendering. Sizes (HEAD only, nothing downloaded) of a
                       random sample of photos across ALL customers, compared
                       with this customer's, to say whether the picked photos
                       are unusual.

Other environment variables:

    MILESTONES   milestones to build (default 8)
    REPEAT       downloads to time (default 2; R2 latency varies a lot)
    PACK_ORDER   an order id (or its first characters) to use instead of the
                 automatic pick (a `complete` pack first, then the most photos)
    PHOTO_MAX_MB skip borrowed photos larger than this (default: no limit)
    PROBE_SECONDS  cap per download in probe mode (default 60)
    SURVEY_N     photos to sample in survey mode (default 60)
    ASSET_BYTES_CACHE_MAX_MB   override the photo-cache cap for this run only

If the customer has more photos than the story needs, the BORROWED ones are
chosen to be the same size as the order's own photos (closest to their median),
not simply the oldest, so the story is a plausible one.

Reading the timing result:

- `wall` is what gunicorn's 120s worker timeout is compared against.
- `storage reads` vs `distinct photos` shows whether the per-request photo
  cache held. Reads equal to distinct photos is the goal; many more means the
  cache filled up and photos are being fetched from R2 again.
- `R2 read time (summed)` can exceed `wall`: the photos are fetched
  concurrently at the start.
- A run that FAILS still prints what it managed to read, because a failure
  caused by slow storage is itself the result.
- Local timings include this machine's distance to Supabase and R2. They are
  not what a VPS will see.
"""

import os
import random
import resource
import statistics
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from django.conf import settings
from django.db import InterfaceError, OperationalError, connection
from django.db.backends.signals import connection_created

MODE = os.environ.get("MODE", "timing").strip().lower()
MILESTONES = int(os.environ.get("MILESTONES", "8"))
REPEAT = int(os.environ.get("REPEAT", "2"))
PICK = os.environ.get("PACK_ORDER", "").strip().lower()
PHOTO_MAX_MB = float(os.environ["PHOTO_MAX_MB"]) if os.environ.get("PHOTO_MAX_MB") else None
PROBE_SECONDS = float(os.environ.get("PROBE_SECONDS", "60"))
SURVEY_N = int(os.environ.get("SURVEY_N", "60"))
if os.environ.get("ASSET_BYTES_CACHE_MAX_MB"):
    settings.ASSET_BYTES_CACHE_MAX_MB = int(os.environ["ASSET_BYTES_CACHE_MAX_MB"])
if MODE not in ("timing", "probe", "survey"):
    raise SystemExit(f"MODE must be timing, probe or survey, not {MODE!r}")


# --- 1. read-only guard, proven before anything else ----------------------
def _guard(sender, connection, **kwargs):
    with connection.cursor() as c:
        c.execute("SET default_transaction_read_only = on")


connection_created.connect(_guard)
connection.close()
with connection.cursor() as c:
    c.execute("SHOW default_transaction_read_only")
    assert c.fetchone()[0] == "on", "read-only guard is not on; stopping"
    try:
        c.execute("CREATE TEMP TABLE _write_probe(x int)")
    except Exception:  # noqa: BLE001
        print("read-only guard: ON, and a write attempt was refused")
    else:
        raise SystemExit("a write was ALLOWED; stopping")
connection.close()
host = connection.settings_dict.get("HOST") or ""
print("mode:", MODE)
print("database:", "local throwaway (db)" if host == "db" else "REMOTE (not the throwaway db)")
print("storage backend:", settings.ASSET_STORAGE_BACKEND, "| photo cache cap:", settings.ASSET_BYTES_CACHE_MAX_MB, "MB"
      "  (a container reads .env.docker only when it is CREATED: after editing it, run"
      " `docker compose up -d --force-recreate api`)")


def db_retry(fn, tries=4):
    """Supabase's pooler sometimes drops a connection that has sat idle (the
    'SSL SYSCALL error: EOF'). That is a connection problem, not a result:
    reconnect and ask again. Reads only, so repeating is always safe."""
    for attempt in range(1, tries + 1):
        try:
            return fn()
        except (OperationalError, InterfaceError) as exc:
            connection.close()
            if attempt == tries:
                raise
            print(f"  (database connection dropped: {type(exc).__name__}; reconnecting, try {attempt + 1}/{tries})")
            time.sleep(1.5 * attempt)


# --- 2. imports that must come after settings are final -------------------
from apps.assets.models import Asset  # noqa: E402
from apps.assets.services import get_asset_storage  # noqa: E402
from apps.commerce.models import Entitlement, Order  # noqa: E402
from apps.delivery import views  # noqa: E402
from apps.delivery.bonuses import pdf_targets_for_order  # noqa: E402
from apps.delivery.photo_prefetch import photo_asset_ids  # noqa: E402
from apps.delivery.print_sizes import all_print_target_ids  # noqa: E402
from apps.delivery.services import get_delivery_for_entitlement  # noqa: E402
from apps.delivery.wallpaper_devices import all_wallpaper_target_ids  # noqa: E402
from apps.projects.models import Project  # noqa: E402

# Mute alerts everywhere they were imported by name.
for _name, _module in list(sys.modules.items()):
    if _name.startswith("apps.") and _module is not None and hasattr(_module, "send_alert"):
        _module.send_alert = lambda *a, **k: None

storage = get_asset_storage()
IS_R2 = hasattr(storage, "_client")


def head_size(key):
    """Size in bytes of one stored object, WITHOUT downloading it."""
    if IS_R2:
        return storage._client.head_object(Bucket=storage._bucket, Key=key)["ContentLength"]
    return len(storage._objects[key])  # the in-memory test storage


def head_sizes(rows):
    """{asset id: bytes or None} for `rows` of (asset id, storage key), 8 at a time."""
    def one(row):
        try:
            return row[0], head_size(row[1])
        except Exception:  # noqa: BLE001
            return row[0], None
    with ThreadPoolExecutor(max_workers=8) as pool:
        return dict(pool.map(one, rows))


def mb(n):
    return f"{n / 1e6:.1f}MB" if n is not None else "?"


def summarise(sizes):
    sizes = sorted(s for s in sizes if s is not None)
    if not sizes:
        return "no sizes"
    pct = lambda p: sizes[min(len(sizes) - 1, int(len(sizes) * p))]  # noqa: E731
    over8 = sum(1 for s in sizes if s > 8e6)
    return (f"n={len(sizes)}  median {mb(statistics.median(sizes))}  p90 {mb(pct(0.9))}  max {mb(sizes[-1])}  "
            f"over 8MB: {over8} ({over8 * 100 // len(sizes)}%)  total {mb(sum(sizes))}")


# --- 3. pick a real order -------------------------------------------------
def _find_candidates():
    qs = (
        Order.objects.filter(status=Order.STATUS_PAID, product__slug="love-story-timeline")
        .exclude(project=None)
        .select_related("project", "delivery_pack", "product", "customer")
    )
    return [o for o in qs if not PICK or str(o.id).lower().startswith(PICK)]


candidates = db_retry(_find_candidates)
if not candidates:
    raise SystemExit("no paid Love Story Timeline order with a project matched")
order = max(candidates, key=lambda o: (o.delivery_pack.slug == "complete", len(set(photo_asset_ids(o.project)))))
project = order.project
customer = order.customer
values = (project.data or {}).get("values") or {}
own_events = values.get("events") or []
own_ids = list(dict.fromkeys(photo_asset_ids(project)))
print(f"picked order {str(order.id)[:8]}  pack={order.delivery_pack.slug}  layout="
      f"{((project.data or {}).get('themeSelections') or {}).get('layout')}  "
      f"stored milestones={len(own_events)}  stored distinct photos={len(own_ids)}")

assets = db_retry(lambda: list(
    Asset.objects.filter(customer=customer, status=Asset.STATUS_UPLOADED, mime_type__startswith="image/")
))
key_of = {str(a.id): a.storage_key for a in assets}
sizes = head_sizes([(i, k) for i, k in key_of.items()])
print(f"this customer has {len(key_of)} uploaded photos.  sizes: {summarise(sizes.values())}")

# --- survey mode ----------------------------------------------------------
if MODE == "survey":
    ids = db_retry(lambda: list(
        Asset.objects.filter(status=Asset.STATUS_UPLOADED, mime_type__startswith="image/").values_list("id", "storage_key")
    ))
    random.shuffle(ids)
    sample = head_sizes([(str(i), k) for i, k in ids[:SURVEY_N]])
    print(f"\nSURVEY of {len(sample)} random photos across all {len(ids)} uploaded photos (sizes only, nothing downloaded):")
    print("  all customers :", summarise(sample.values()))
    print("  this customer :", summarise(sizes.values()))
    mine = sorted(s for s in sizes.values() if s is not None)
    if mine and sample:
        theirs = sorted(s for s in sample.values() if s is not None)
        print(f"  this customer's median is {statistics.median(mine) / statistics.median(theirs):.1f}x the all-customer median")
    raise SystemExit(0)

# --- 4. choose the story's photos -------------------------------------------
own_known = [i for i in own_ids if i in key_of]
own_sizes = [sizes[i] for i in own_known if sizes.get(i)]
target = statistics.median(own_sizes) if own_sizes else 5e6
pool = [
    i for i in key_of
    if i not in own_known and sizes.get(i) and (PHOTO_MAX_MB is None or sizes[i] <= PHOTO_MAX_MB * 1e6)
]
pool.sort(key=lambda i: abs(sizes[i] - target))
photos = own_known + pool[: max(0, MILESTONES - len(own_known))]
if not own_events or not photos:
    raise SystemExit("this order has no milestones or no photos to build from")
chosen = photos[:MILESTONES]
print(f"\nthe story's {len(chosen)} photos ({len(own_known)} are the order's own, the rest borrowed from the same customer"
      f" at about the same size):")
for n, i in enumerate(chosen, 1):
    print(f"  {n}. {mb(sizes.get(i)):>8}  {'own' if i in own_known else 'borrowed'}")
total_bytes = sum(sizes.get(i) or 0 for i in chosen)
print(f"  total {mb(total_bytes)}  (photo cache cap {settings.ASSET_BYTES_CACHE_MAX_MB}MB"
      f"{'  -> MORE THAN THE CAP: photos will be re-read' if total_bytes > settings.ASSET_BYTES_CACHE_MAX_MB * 1048576 else ''})")
if len(chosen) < MILESTONES:
    print(f"WARNING: only {len(chosen)} distinct photos for {MILESTONES} milestones; photos are reused, so storage "
          "reads are UNDERSTATED compared with a story of different photos")

# --- probe mode -----------------------------------------------------------
if MODE == "probe":
    keys = [key_of[i] for i in chosen]
    print("\nPROBE (no rendering). Everything below is R2 as seen from this machine.")

    # Latency: a HEAD moves no body, so its time is the round trip.
    rtts = []
    for _ in range(5):
        t = time.perf_counter()
        head_size(keys[0])
        rtts.append(time.perf_counter() - t)
    print(f"  round trip (HEAD, 5x): median {statistics.median(rtts) * 1000:.0f}ms  worst {max(rtts) * 1000:.0f}ms")

    def raw_get(key):
        """(time to first byte, total seconds, bytes, finished?) for one photo, no retries, no budget."""
        t0 = time.perf_counter()
        if not IS_R2:
            data = storage.download(key)
            return 0.0, time.perf_counter() - t0, len(data), True
        try:
            body = storage._client.get_object(Bucket=storage._bucket, Key=key)["Body"]
            ttfb = time.perf_counter() - t0
            n = 0
            for chunk in body.iter_chunks(64 * 1024):
                n += len(chunk)
                if time.perf_counter() - t0 > PROBE_SECONDS:
                    body.close()
                    return ttfb, time.perf_counter() - t0, n, False
            return ttfb, time.perf_counter() - t0, n, True
        except Exception as exc:  # noqa: BLE001
            return None, time.perf_counter() - t0, 0, type(exc).__name__

    # One photo at a time: the smallest, the middle, the largest.
    order_by_size = sorted(chosen, key=lambda i: sizes.get(i) or 0)
    picks = list(dict.fromkeys([order_by_size[0], order_by_size[len(order_by_size) // 2], order_by_size[-1]]))
    print(f"  one photo at a time (each capped at {PROBE_SECONDS:.0f}s):")
    for i in picks:
        ttfb, secs, n, ok = raw_get(key_of[i])
        state = "ok" if ok is True else ("CUT OFF at the cap" if ok is False else f"FAILED ({ok})")
        rate = f"{n / 1e6 / secs:.2f}MB/s" if secs and n else "-"
        first = f"first byte {ttfb * 1000:.0f}ms" if ttfb is not None else "no first byte"
        print(f"    {mb(sizes.get(i)):>8} photo: {secs:5.1f}s  {rate:>9}  {first}  {state}")

    # All of them together, 6 at a time: what the pack's prefetch does.
    print(f"  all {len(keys)} together, 6 at a time (what the pack's prefetch does):")
    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(raw_get, keys))
    secs = time.perf_counter() - t0
    done = sum(r[2] for r in results)
    finished = sum(1 for r in results if r[3] is True)
    print(f"    {finished}/{len(keys)} finished, {mb(done)} in {secs:.1f}s = {done / 1e6 / secs:.2f}MB/s overall"
          f"   (the pack gives its prefetch {settings.ASSET_PREFETCH_BUDGET_SECONDS}s and all reads "
          f"{settings.ASSET_READ_BUDGET_SECONDS}s)")
    raise SystemExit(0)

# --- 5. timing mode: build the N-milestone story in memory -------------------
new_events = []
used_dates = {e.get("date") for e in own_events[:MILESTONES]}
for i in range(MILESTONES):
    event = dict(own_events[i % len(own_events)])
    event["photo"] = {"assetId": chosen[i % len(chosen)]}
    if i >= len(own_events):
        # The renderer rejects two milestones on the same date, so a copied
        # milestone gets a fresh one rather than its original's.
        year = 2000 + i
        while f"{year}-06-15" in used_dates:
            year += 1
        event["date"] = f"{year}-06-15"
        used_dates.add(event["date"])
    new_events.append(event)
new_data = {**project.data, "values": {**values, "events": new_events}}
project.data = new_data

# Delivery re-loads `order.project` from the database for every entitlement
# (select_related), which would bring back the stored milestones; make every
# load of THIS project come back with the in-memory story instead.
_target_pk = project.pk
_orig_from_db = Project.from_db.__func__


def _from_db(cls, db, field_names, values_):
    instance = _orig_from_db(cls, db, field_names, values_)
    if instance.pk == _target_pk:
        instance.data = new_data
    return instance


Project.from_db = classmethod(_from_db)

# A Complete pack's contents, in memory only. `__live__` is kept only if this
# order really has it (its QR bonus needs the real hosted-page row).
real_targets = list(order.delivery_pack.included_targets or [])
targets = [*all_print_target_ids(), *all_wallpaper_target_ids()]
if "__live__" in real_targets:
    targets.append("__live__")
order.delivery_pack.included_targets = targets
print(f"\ntiming a Complete-shaped pack: {len(all_print_target_ids())} print + "
      f"{len(all_wallpaper_target_ids())} wallpaper targets, {MILESTONES} milestones "
      f"(moment wallpapers: {3 * MILESTONES})")


def _pack_deliveries(order_):
    for target_id in sorted(t for t in order_.delivery_pack.included_targets if t != "__live__"):
        entitlement = Entitlement(order=order_, product=order_.product, target_id=target_id)
        yield entitlement, get_delivery_for_entitlement(entitlement)


views.get_pack_deliveries_for_order = _pack_deliveries

# --- 6. instrument storage and the database --------------------------------
reads, failures, lock = [], [], threading.Lock()
_orig_download = type(storage).download
_run_start = [0.0]


def _timed_download(self, key):
    t = time.perf_counter()
    try:
        data = _orig_download(self, key)
    except BaseException as exc:
        with lock:
            failures.append((key, t - _run_start[0], time.perf_counter() - t, type(exc).__name__))
        raise
    with lock:
        reads.append((key, time.perf_counter() - t, len(data), t - _run_start[0]))
    return data


type(storage).download = _timed_download

queries = {"n": 0, "s": 0.0}


def _count_queries(execute, sql, params, many, context):
    t = time.perf_counter()
    try:
        return execute(sql, params, many, context)
    finally:
        queries["n"] += 1
        queries["s"] += time.perf_counter() - t


phase = {}
_orig_moment = views.moment_wallpapers_for_order


def _timed_moment(order_):
    phase["moment_start"] = time.perf_counter()
    yield from _orig_moment(order_)
    phase["moment_end"] = time.perf_counter()


views.moment_wallpapers_for_order = _timed_moment

# --- 7. run ---------------------------------------------------------------
pdf_targets = set(pdf_targets_for_order(order))
for run in range(1, REPEAT + 1):
    reads.clear()
    failures.clear()
    queries.update(n=0, s=0.0)
    phase.clear()
    total = 0
    first = None
    connection.close()  # start each run on a fresh connection, not one that has sat idle
    t0 = time.perf_counter()
    _run_start[0] = t0
    try:
        with connection.execute_wrapper(_count_queries):
            for chunk in views._iter_pack_archive(order, pdf_targets):
                total += len(chunk)
                first = first if first is not None else time.perf_counter() - t0
            wall = time.perf_counter() - t0
    except Exception as exc:  # noqa: BLE001
        took = time.perf_counter() - t0
        print(f"\nRUN {run} FAILED after {took:.1f}s: {type(exc).__name__}: {exc}")
        print("  details:", getattr(exc, "details", None))
        if isinstance(exc, (OperationalError, InterfaceError)):
            print("  This is a dropped DATABASE connection, not a timing result. Run it again.")
        keys = [r[0] for r in reads]
        print(f"  storage reads that finished: {len(keys)} ({len(set(keys))} distinct photos, "
              f"{sum(r[2] for r in reads) / 1e6:.0f}MB, "
              f"slowest {max((r[1] for r in reads), default=0):.1f}s)")
        print(f"  storage reads that FAILED:   {len(failures)} "
              f"({len({f[0] for f in failures})} distinct photos)")
        for key, started, secs, kind in failures:
            size = next((sizes.get(i) for i, k in key_of.items() if k == key), None)
            print(f"    {mb(size):>8} photo: started at +{started:5.1f}s, failed after {secs:5.1f}s ({kind})")
        of_chosen = len({key_of[i] for i in chosen})
        if len(set(keys)) < of_chosen:
            print(f"  only {len(set(keys))} of the story's {of_chosen} distinct photos were read before it gave up, "
                  "so it never reached the point where the photo cache could matter")
        raise SystemExit(1)
    moment = phase.get("moment_end", 0) - phase.get("moment_start", 0)
    keys = [r[0] for r in reads]
    summed = sum(r[1] for r in reads)
    slowest = max((r[1] for r in reads), default=0)
    mb_read = sum(r[2] for r in reads) / 1e6
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    print(f"\nRUN {run}/{REPEAT}  milestones={MILESTONES}")
    print(f"  wall            {wall:6.1f}s   (limit 120s -> {wall / 120 * 100:.0f}% used; first byte {first:.1f}s)")
    print(f"  moment wallpapers {moment:5.1f}s   everything else {wall - moment:.1f}s")
    print(f"  storage reads   {len(keys)} for {len(set(keys))} distinct photos   ({mb_read:.0f}MB read)")
    print(f"  R2 read time (summed) {summed:.1f}s   slowest single read {slowest:.1f}s")
    print(f"  database        {queries['n']} queries, {queries['s']:.1f}s")
    print(f"  zip {total / 1e6:.0f}MB   peak RSS so far {rss:.0f}MB")
    if len(keys) > len(set(keys)):
        print("  !! photos were read from storage more than once: the cache cap is too small for this story")

print("\nnothing was written: read-only guard stayed on, no rows saved, no alerts sent")
