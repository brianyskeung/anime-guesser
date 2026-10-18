"""Scrape the top N most popular anime from MyAnimeList into data/anime.js.

Usage:  python scripts/scrape.py [--count 1000] [--delay 1.2]

Pages are cached in scripts/.cache so re-runs only fetch what's missing.
Delete the cache folder to force a full refresh.
"""
import argparse
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(__file__).resolve().parent / ".cache"
OUT = ROOT / "data" / "anime.js"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

# Streaming services worth showing as a clue (MAL lists many regional ones).
STREAMS = {
    "Crunchyroll", "Netflix", "Hulu", "Amazon Prime Video", "Disney Plus", "HIDIVE",
    "Max", "HBO Max", "Tubi TV", "Apple TV Plus", "Peacock", "Adult Swim", "Bilibili",
}
# Relations that keep you inside the same "show" for counting TV seasons.
SEASON_LINKS = {"Sequel", "Prequel"}


def fetch(url, cache_name, delay):
    path = CACHE / cache_name
    if path.exists():
        return path.read_text(encoding="utf-8")
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en"})
            with urllib.request.urlopen(req, timeout=40) as r:
                body = r.read().decode("utf-8", "replace")
            path.write_text(body, encoding="utf-8")
            time.sleep(delay)
            return body
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return ""
            wait = 10 * (attempt + 1)
            print(f"  HTTP {e.code} on {url}, retrying in {wait}s", flush=True)
            time.sleep(wait)
        except Exception as e:  # network hiccup
            wait = 5 * (attempt + 1)
            print(f"  {e!r} on {url}, retrying in {wait}s", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"giving up on {url}")


def clean(s):
    s = re.sub(r"<[^>]+>", "", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def info_field(page, label):
    m = re.search(
        r'<span class="dark_text">' + re.escape(label) + r':</span>(.*?)</div>', page, re.S
    )
    return m.group(1) if m else None


def link_titles(fragment):
    return [html.unescape(t) for t in re.findall(r'<a href="/anime/[^"]+" title="([^"]+)"', fragment or "")]


def parse_anime(mal_id, page):
    title = clean(re.search(r'<h1 class="title-name[^"]*"><strong>(.*?)</strong>', page, re.S).group(1))
    english = clean(info_field(page, "English") or "") or None
    japanese = clean(info_field(page, "Japanese") or "") or None
    synonyms = [s.strip() for s in clean(info_field(page, "Synonyms") or "").split(",") if s.strip()]

    eps_raw = clean(info_field(page, "Episodes"))
    episodes = int(eps_raw) if eps_raw.isdigit() else None
    aired = clean(info_field(page, "Aired"))
    year_m = re.search(r"(\d{4})", aired)
    premiered = clean(info_field(page, "Premiered") or "")

    score_m = re.search(r'itemprop="ratingValue"[^>]*>([\d.]+)<', page)
    pop_m = re.search(r'<span class="dark_text">Popularity:</span>\s*#(\d+)', page)
    rank_m = re.search(r'<span class="dark_text">Ranked:</span>\s*#(\d+)', page)
    members_m = re.search(r'<span class="dark_text">Members:</span>\s*([\d,]+)', page)
    img_m = re.search(r'<meta property="og:image" content="([^"]+)"', page)
    syn_m = re.search(r'<p itemprop="description">(.*?)</p>', page, re.S)
    synopsis = clean(syn_m.group(1)) if syn_m else ""
    synopsis = re.sub(r"\s*\[Written by MAL Rewrite\]\s*$", "", synopsis)

    demo = link_titles(info_field(page, "Demographic") or info_field(page, "Demographics"))
    studios = [s for s in link_titles(info_field(page, "Studios")) if s]
    if not studios:
        studios = ["Unknown"]

    streams = []
    for m in re.finditer(r'<a [^>]*title="([^"]+)" class="broadcast-item', page):
        n = html.unescape(m.group(1))
        if n in STREAMS and n not in streams:
            streams.append("Max" if n == "HBO Max" else n)

    relations = []
    rel_block = re.search(r'<table class="entries-table">(.*?)</table>', page, re.S)
    if rel_block:
        for row in re.finditer(r'<td[^>]*nowrap">\s*([^<:]+):\s*</td>(.*?)</tr>', rel_block.group(1), re.S):
            kind = row.group(1).strip()
            for li in re.finditer(r'myanimelist\.net/anime/(\d+)/[^"]*">[^<]*</a>\s*\(([^)]+)\)', row.group(2)):
                relations.append([kind, int(li.group(1)), li.group(2).strip()])
    # Tile-style relations (shown when there are few entries)
    for tile in re.finditer(r'<div class="relation">\s*([^<(]+?)\s*\(([^)]+)\)\s*</div>\s*<div class="title">\s*<a href="https://myanimelist\.net/anime/(\d+)/', page):
        relations.append([tile.group(1).strip(), int(tile.group(3)), tile.group(2).strip()])

    return {
        "id": mal_id,
        "title": title,
        "en": english,
        "jp": japanese,
        "alt": synonyms,
        "type": clean(info_field(page, "Type")) or "Unknown",
        "eps": episodes,
        "year": int(year_m.group(1)) if year_m else None,
        "season": premiered if premiered and premiered != "?" else None,
        "studios": studios,
        "source": clean(info_field(page, "Source")) or "Unknown",
        "genres": link_titles(info_field(page, "Genres") or info_field(page, "Genre")),
        "themes": link_titles(info_field(page, "Themes") or info_field(page, "Theme")),
        "demo": demo[0] if demo else None,
        "rating": (clean(info_field(page, "Rating")) or "").split(" (")[0] or None,
        "score": float(score_m.group(1)) if score_m else None,
        "rank": int(rank_m.group(1)) if rank_m else None,
        "pop": int(pop_m.group(1)) if pop_m else None,
        "members": int(members_m.group(1).replace(",", "")) if members_m else None,
        "img": img_m.group(1) if img_m else None,
        "synopsis": synopsis,
        "streams": streams,
        "_rel": relations,
    }


def count_seasons(entries):
    """Count TV entries in each sequel/prequel chain, using whatever relations we scraped."""
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    tv_ids = set()
    for e in entries:
        find(e["id"])
        if e["type"] == "TV":
            tv_ids.add(e["id"])
        for kind, rid, rtype in e["_rel"]:
            if kind in SEASON_LINKS:
                parent[find(rid)] = find(e["id"])
                if rtype == "TV":
                    tv_ids.add(rid)
    groups = {}
    for tid in tv_ids:
        groups.setdefault(find(tid), set()).add(tid)
    for e in entries:
        e["seasons"] = len(groups.get(find(e["id"]), ()))
        e["franchise"] = find(e["id"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=1000)
    ap.add_argument("--delay", type=float, default=1.2)
    ap.add_argument("--max-chain", type=int, default=800, help="cap on extra sequel/prequel pages to fetch")
    args = ap.parse_args()
    CACHE.mkdir(exist_ok=True)
    OUT.parent.mkdir(exist_ok=True)

    ids = []
    for offset in range(0, args.count, 50):
        page = fetch(
            f"https://myanimelist.net/topanime.php?type=bypopularity&limit={offset}",
            f"top_{offset}.html", args.delay,
        )
        for mid in re.findall(r'<tr class="ranking-list">.*?myanimelist\.net/anime/(\d+)/', page, re.S):
            if int(mid) not in ids:
                ids.append(int(mid))
        print(f"list offset {offset}: {len(ids)} ids", flush=True)
    ids = ids[: args.count]

    entries = []
    for i, mid in enumerate(ids, 1):
        page = fetch(f"https://myanimelist.net/anime/{mid}", f"anime_{mid}.html", args.delay)
        try:
            e = parse_anime(mid, page)
        except Exception as ex:
            print(f"  failed to parse {mid}: {ex!r}", file=sys.stderr)
            continue
        entries.append(e)
        if i % 25 == 0 or i == len(ids):
            print(f"[{i}/{len(ids)}] {e['title']}", flush=True)

    # Follow sequel/prequel links past the top list so long franchises get full season counts.
    known = {e["id"] for e in entries}
    queue = [rid for e in entries for kind, rid, _ in e["_rel"] if kind in SEASON_LINKS and rid not in known]
    extras = []
    while queue and len(extras) < args.max_chain:
        rid = queue.pop()
        if rid in known:
            continue
        known.add(rid)
        page = fetch(f"https://myanimelist.net/anime/{rid}", f"anime_{rid}.html", args.delay)
        try:
            x = parse_anime(rid, page)
        except Exception as ex:
            print(f"  failed to parse chain entry {rid}: {ex!r}", file=sys.stderr)
            continue
        extras.append(x)
        queue += [r for kind, r, _ in x["_rel"] if kind in SEASON_LINKS and r not in known]
        if len(extras) % 25 == 0:
            print(f"  followed {len(extras)} sequel/prequel entries outside the list", flush=True)
    print(f"followed {len(extras)} sequel/prequel entries outside the list", flush=True)

    count_seasons(entries + extras)
    entries.sort(key=lambda e: e["pop"] or 99999)
    for e in entries:
        del e["_rel"]
    js = "// Generated by scripts/scrape.py from MyAnimeList. Do not edit by hand.\n"
    js += f"window.ANIME_DATA = {json.dumps(entries, ensure_ascii=False, separators=(',', ':'))};\n"
    js += f"window.ANIME_DATA_UPDATED = {json.dumps(time.strftime('%Y-%m-%d'))};\n"
    OUT.write_text(js, encoding="utf-8")
    print(f"wrote {len(entries)} anime to {OUT}")

    import enrich_anilist  # same folder; adds tags + "fans also liked" for the hints
    enrich_anilist.main()


if __name__ == "__main__":
    main()
