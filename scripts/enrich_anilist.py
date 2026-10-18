"""Add AniList tags and "fans also liked" recommendations to data/anime.js.

Usage:  python scripts/enrich_anilist.py

Run after scripts/scrape.py. Looks anime up by their MAL id, 50 per request.
Responses are cached in scripts/.cache/anilist_*.json.
"""
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(__file__).resolve().parent / ".cache"
DATA = ROOT / "data" / "anime.js"
API = "https://graphql.anilist.co"
QUERY = """
query ($ids: [Int]) {
  Page(perPage: 50) {
    media(idMal_in: $ids, type: ANIME) {
      idMal
      tags { name rank isMediaSpoiler isGeneralSpoiler }
      recommendations(perPage: 8, sort: RATING_DESC) {
        nodes { rating mediaRecommendation { idMal title { romaji english } } }
      }
    }
  }
}
"""


def post(ids):
    body = json.dumps({"query": QUERY, "variables": {"ids": ids}}).encode()
    for attempt in range(6):
        try:
            req = urllib.request.Request(API, data=body, headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "Mozilla/5.0 (anime-guesser data script)"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.load(r)["data"]["Page"]["media"]
        except urllib.error.HTTPError as e:
            wait = int(e.headers.get("Retry-After") or 0) or 15 * (attempt + 1)
            print(f"  HTTP {e.code}, retrying in {wait}s", flush=True)
            time.sleep(wait)
        except Exception as e:
            print(f"  {e!r}, retrying", flush=True)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("AniList keeps failing")


def main():
    CACHE.mkdir(exist_ok=True)
    src = DATA.read_text(encoding="utf-8")
    m = re.search(r"window\.ANIME_DATA = (\[.*?\]);\n", src, re.S)
    entries = json.loads(m.group(1))
    ids = [e["id"] for e in entries]

    found = {}
    for i in range(0, len(ids), 50):
        chunk = ids[i : i + 50]
        cache = CACHE / f"anilist_{chunk[0]}_{len(chunk)}_{hash(tuple(chunk)) & 0xffffffff:x}.json"
        if cache.exists():
            media = json.loads(cache.read_text(encoding="utf-8"))
        else:
            media = post(chunk)
            cache.write_text(json.dumps(media), encoding="utf-8")
            time.sleep(2.5)  # AniList allows ~30 requests/minute
        for md in media:
            if md.get("idMal"):
                found[md["idMal"]] = md
        print(f"anilist {min(i + 50, len(ids))}/{len(ids)}", flush=True)

    for e in entries:
        md = found.get(e["id"])
        if not md:
            e["tags"], e["recs"] = [], []
            continue
        tags = [t for t in md["tags"] if not t["isMediaSpoiler"] and not t["isGeneralSpoiler"]]
        tags.sort(key=lambda t: -t["rank"])
        e["tags"] = [t["name"] for t in tags[:8]]
        recs = []
        for node in md["recommendations"]["nodes"]:
            r = node.get("mediaRecommendation")
            if not r or (node.get("rating") or 0) <= 0:
                continue
            recs.append({"id": r.get("idMal"), "name": r["title"]["english"] or r["title"]["romaji"]})
        e["recs"] = recs[:6]

    new = src[: m.start(1)] + json.dumps(entries, ensure_ascii=False, separators=(",", ":")) + src[m.end(1) :]
    DATA.write_text(new, encoding="utf-8")
    print(f"enriched {len(found)}/{len(entries)} anime with AniList tags and recommendations")


if __name__ == "__main__":
    main()
