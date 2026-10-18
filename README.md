# Unlimited Anime Guesser

Saw an anime guessing game that didn't have unlimited mode so made one myself. 

A Spotle-style anime guessing game you can play as many times as you want.
Pick a mode, guess an anime, and use the clue cards to narrow it down within 10 guesses.

- **Regular:** the answer is from MAL's top 500 most popular anime
- **Easy:** the answer is from the top 300
- You can guess any of the 500 in either mode
- Hints unlock at guess 5 and guess 9 (premise, blurred poster, or genres). Each costs a guess
- Stats and streaks are saved per mode in your browser

## Play

It's a static site with no build step. Open `index.html` directly, or serve the folder:

```bash
python -m http.server 5173
```

Then open http://localhost:5173.

Keyboard: type to search, `↑`/`↓` to move, `Enter` to guess, `Enter` again after a round to get the next anime, `/` to focus the search.

## Refresh the data

`data/anime.js` is generated from MyAnimeList (popularity rank, score, studios, source, genres, streaming, etc.):

```bash
python scripts/scrape.py --count 500
```

Pages are cached in `scripts/.cache/`, so re-runs are fast. Delete that folder to pull fresh numbers.
The scraper waits ~1.2s between requests to be polite to MAL; a full run takes 15–20 minutes.

## Clues

| Clue | Yellow (close) when |
|---|---|
| Debut | within 2 years (arrow points to the answer) |
| Format | exact only |
| Episodes | within 3 or 25% |
| Studio | at least one shared |
| Source | exact only |
| MAL score | within 0.3 |
| Popularity | within 25 places or 10% (↑ = answer is more popular) |
| Age rating | one step away (G → PG → PG-13 → R → R+) |
| TV seasons | within 1 (TV entries in the sequel/prequel chain) |
| Similarity | genres/themes/demographic overlap, Cold → Scorching |
| Streams on | shared services light up |