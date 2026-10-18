(() => {
  "use strict";

  const DATA = window.ANIME_DATA || [];
  const MAX_GUESSES = 10;
  const HINT_AT = [5, 9]; // hints unlock at these guess numbers
  const MODES = {
    regular: { label: "Regular · Top 500", size: 500 },
    easy: { label: "Easy · Top 300", size: 300 },
    hard: { label: "Hard · Top 1000", size: 1000 },
  };
  const RATING_ORDER = ["G", "PG", "PG-13", "R", "R+", "Rx"];
  const STOP = new Set("the and for with from that this season part movie film final first second third no wa ga wo ni to de of a an in on".split(" "));

  const byId = new Map(DATA.map((a) => [a.id, a]));
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9぀-ヿ一-龯]+/g, " ").trim();

  // ---------- storage (fails soft in private mode) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("ag:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("ag:" + k, JSON.stringify(v)); } catch {} },
  };

  // ---------- search index ----------
  const index = DATA.map((a) => {
    const names = [a.title, a.en, a.jp, ...(a.alt || [])].filter(Boolean);
    return { a, names, keys: names.map(norm) };
  });

  function search(q, exclude) {
    const nq = norm(q);
    if (!nq) return [];
    const out = [];
    for (const it of index) {
      if (exclude.has(it.a.id)) continue;
      let best = 0, hit = null;
      it.keys.forEach((k, i) => {
        let s = 0;
        if (k === nq) s = 100;
        else if (k.startsWith(nq)) s = 80;
        else if ((" " + k).includes(" " + nq)) s = 60;
        else if (k.includes(nq)) s = 40;
        else if (nq.includes(" ") && nq.split(" ").every((w) => k.includes(w))) s = 25;
        if (i > 0 && s) s -= 3; // prefer the main title on ties
        if (s > best) { best = s; hit = it.names[i]; }
      });
      if (best) out.push({ a: it.a, score: best - Math.min(it.a.pop || 9999, 9999) / 2000, hit });
    }
    return out.sort((x, y) => y.score - x.score).slice(0, 8);
  }

  // ---------- game state ----------
  let mode = store.get("mode", "regular");
  if (!MODES[mode]) mode = "regular";
  let game = null;

  function pool() {
    return DATA.slice(0, Math.min(MODES[mode].size, DATA.length));
  }

  function pickAnswer() {
    const p = pool();
    const recent = store.get("recent:" + mode, []);
    const avoid = new Set(recent.slice(-Math.floor(p.length * 0.6)));
    const fresh = p.filter((a) => !avoid.has(a.id));
    const choice = (fresh.length ? fresh : p)[Math.floor(Math.random() * (fresh.length || p.length))];
    store.set("recent:" + mode, [...recent, choice.id].slice(-400));
    return choice;
  }

  function newGame() {
    const answer = pickAnswer();
    game = { mode, answer: answer.id, turns: [], over: false, won: false };
    store.set("round:" + mode, (store.get("round:" + mode, 0)) + 1);
    save();
    render(true);
    $("#searchInput").focus();
  }

  function save() { store.set("game:" + mode, game); }

  function loadOrNew() {
    const g = store.get("game:" + mode, null);
    if (g && byId.has(g.answer) && !g.over) { game = g; render(true); }
    else newGame();
  }

  const used = () => game.turns.length;
  const guessIds = () => new Set(game.turns.filter((t) => t.id).map((t) => t.id));

  function submitGuess(id) {
    if (game.over || used() >= MAX_GUESSES) return;
    if (guessIds().has(id)) return;
    game.turns.push({ id });
    const won = id === game.answer;
    if (won || used() >= MAX_GUESSES) finish(won);
    save();
    render();
  }

  function useHint(kind) {
    if (game.over || !hintAvailable()) return;
    game.turns.push({ hint: kind });
    if (used() >= MAX_GUESSES) finish(false);
    save();
    render();
  }

  function hintsUsed() { return game.turns.filter((t) => t.hint).length; }
  function hintAvailable() {
    // one hint per unlocked slot; never let a hint eat the final guess
    const unlocked = HINT_AT.filter((n) => used() + 1 >= n).length;
    return hintsUsed() < unlocked && used() < MAX_GUESSES - 1;
  }

  function finish(won) {
    game.over = true;
    game.won = won;
    const stats = getStats();
    stats.played++;
    if (won) {
      stats.wins++;
      stats.streak++;
      stats.best = Math.max(stats.best, stats.streak);
      stats.dist[used() - 1]++;
    } else {
      stats.streak = 0;
    }
    stats.last = won ? used() : null;
    store.set("stats:" + mode, stats);
    const history = store.get("history", []);
    history.push({ mode, answer: game.answer, won, turns: game.turns, at: Date.now() });
    store.set("history", history.slice(-1000));
  }

  function getStats() {
    return store.get("stats:" + mode, null) || { played: 0, wins: 0, streak: 0, best: 0, dist: Array(MAX_GUESSES).fill(0), last: null };
  }

  // ---------- comparisons ----------
  const ICON = {
    check: '<svg viewBox="0 0 12 12"><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg viewBox="0 0 12 12"><path d="M3.5 3.5l5 5m0-5-5 5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>',
    up: '<svg viewBox="0 0 12 12"><path d="M6 9.5v-7M3 5.2 6 2.4l3 2.8" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 12 12"><path d="M6 2.5v7M3 6.8 6 9.6l3-2.8" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  // Returns {state: match|close|miss, dir: up|down|null}
  function cmpNum(g, a, closeFn, invert = false) {
    if (g == null || a == null) return { state: g === a ? "match" : "miss", dir: null };
    if (g === a) return { state: "match", dir: null };
    let dir = a > g ? "up" : "down";
    if (invert) dir = dir === "up" ? "down" : "up";
    return { state: closeFn(g, a) ? "close" : "miss", dir };
  }
  const cmpEq = (g, a) => ({ state: g === a ? "match" : "miss", dir: null });

  function similarity(g, a) {
    if (g.id === a.id) return 5;
    if (g.franchise && g.franchise === a.franchise) return 4;
    const set = (x) => new Set([...(x.genres || []), ...(x.themes || []), x.demo].filter(Boolean));
    const A = set(g), B = set(a);
    const inter = [...A].filter((x) => B.has(x)).length;
    const uni = new Set([...A, ...B]).size || 1;
    let j = inter / uni;
    if (g.source === a.source) j += 0.05;
    if (g.studios.some((s) => a.studios.includes(s))) j += 0.08;
    if (j >= 0.7) return 4;
    if (j >= 0.45) return 3;
    if (j >= 0.25) return 2;
    if (j >= 0.1) return 1;
    return 0;
  }
  const HEAT = [
    ["Cold", "#7aa7ff"], ["Cool", "#5ec6e8"], ["Warm", "#f1bd3c"], ["Hot", "#f2793b"], ["Scorching", "#e2264d"], ["Scorching", "#0f9a5f"],
  ];

  function compare(g, a) {
    const shortRating = (r) => (r || "").split(" - ")[0];
    const ri = (r) => RATING_ORDER.indexOf(shortRating(r));
    const gs = new Set(g.studios), as = new Set(a.studios);
    const studioShared = [...gs].filter((s) => as.has(s)).length;
    return {
      debut: cmpNum(g.year, a.year, (x, y) => Math.abs(x - y) <= 2),
      format: cmpEq(g.type, a.type),
      episodes: cmpNum(g.eps, a.eps, (x, y) => Math.abs(x - y) <= 3 || Math.abs(x - y) <= 0.25 * Math.max(x, y)),
      source: cmpEq(g.source, a.source),
      studio: { state: studioShared && gs.size === as.size && studioShared === gs.size ? "match" : studioShared ? "close" : "miss", dir: null },
      score: cmpNum(g.score, a.score, (x, y) => Math.abs(x - y) <= 0.3 + 1e-9),
      // Lower rank number = more popular, so "up" means the answer is more popular.
      pop: cmpNum(g.pop, a.pop, (x, y) => Math.abs(x - y) <= 25 || Math.abs(x - y) <= 0.1 * Math.max(x, y), true),
      seasons: cmpNum(g.seasons, a.seasons, (x, y) => Math.abs(x - y) <= 1),
      rating: (() => {
        const x = ri(g.rating), y = ri(a.rating);
        if (x === y) return { state: "match", dir: null };
        return { state: x >= 0 && y >= 0 && Math.abs(x - y) === 1 ? "close" : "miss", dir: y > x ? "up" : "down" };
      })(),
      heat: similarity(g, a),
    };
  }

  // ---------- rendering ----------
  function badge(c) {
    const icon = c.state === "match" ? ICON.check : c.dir ? ICON[c.dir] : ICON.x;
    return `<span class="badge">${icon}</span>`;
  }

  // Small label icons, drawn at 12px
  const LI = {
    debut: '<path d="M2 4h10v8H2zM2 6.5h10M4.5 2.5v2.5M9.5 2.5v2.5"/>',
    format: '<path d="M2 4.5h10v7H2zM5 2l2 2.5L9 2"/>',
    episodes: '<path d="M2 3h10v8H2zM2 5.5h10M2 8.5h10M4.5 3v8"/>',
    source: '<path d="M7 4c-1.5-1-3.5-1.2-5-.8v7.6c1.5-.4 3.5-.2 5 .8 1.5-1 3.5-1.2 5-.8V3.2c-1.5-.4-3.5-.2-5 .8zM7 4v7.6"/>',
    studio: '<path d="M2 12V6l3-2v2l3-2v2l3-2v8zM5 9h1M8 9h1"/>',
    score: '<path d="m7 2 1.5 3.2 3.5.4-2.6 2.4.7 3.5L7 9.8l-3.1 1.7.7-3.5L2 5.6l3.5-.4z" fill="currentColor"/>',
    pop: '<path d="M2 12h10M3.5 12V8M7 12V4M10.5 12V6.5"/>',
    seasons: '<path d="m7 2 5 2.5L7 7 2 4.5zM2 7l5 2.5L12 7M2 9.5 7 12l5-2.5"/>',
    heat: '<path d="M7 1.8c.4 2.2 3.2 3.2 3.2 6.2A3.2 3.2 0 0 1 3.8 8c0-1.5.8-2.3 1.4-3 .2 1 .7 1.6 1.3 1.8C6.6 5 6.4 3.4 7 1.8z" fill="currentColor"/>',
    rating: '<path d="M7 1.8 11.5 3.5v3.3c0 2.6-1.9 4.5-4.5 5.4-2.6-.9-4.5-2.8-4.5-5.4V3.5z"/>',
  };
  const icon = (k) => `<svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${LI[k]}</svg>`;

  // Streaming service tiles: [short label, text color, background]
  const STREAM_STYLE = {
    "Crunchyroll": ["CR", "#fff", "#f47521"],
    "Netflix": ["N", "#e50914", "#fff"],
    "Hulu": ["hulu", "#1ce783", "#fff"],
    "Amazon Prime Video": ["prime", "#00a8e1", "#fff"],
    "Disney Plus": ["D+", "#fff", "#113ccf"],
    "Max": ["max", "#fff", "#002be7"],
    "HBO Max": ["max", "#fff", "#002be7"],
    "Tubi TV": ["tubi", "#7408ff", "#fff"],
    "HIDIVE": ["HIDIVE", "#fff", "#00baff"],
    "Apple TV Plus": ["tv+", "#fff", "#111"],
    "Peacock": ["peacock", "#111", "#fff"],
    "Adult Swim": ["[as]", "#111", "#fff"],
    "Bilibili": ["bili", "#fff", "#00a1d6"],
  };

  function cell(key, label, value, c, extra = "") {
    return `<div class="cell ${c.state} ${extra}"><div class="cell-label">${icon(key)}${label}</div>${badge(c)}<div class="cell-value" title="${esc(value)}">${esc(value)}</div></div>`;
  }

  function fmtEps(a) { return a.eps == null ? "Airing" : a.eps; }
  const malUrl = (a) => `https://myanimelist.net/anime/${a.id}`;

  function guessCard(g, a, n, delayed) {
    const c = compare(g, a);
    const correct = g.id === a.id;
    const aTags = new Set([...(a.genres || []), ...(a.themes || [])]);
    const tags = [...(g.genres || []), ...(g.themes || [])]
      .map((t) => `<span class="tag ${aTags.has(t) ? "on" : ""}">${esc(t)}</span>`).join("");
    const heat = correct ? 5 : c.heat;
    const heatState = heat >= 4 ? "match" : heat >= 2 ? "close" : "miss";
    const streams = (g.streams || []).length
      ? g.streams.map((s) => {
          const [txt, fg, bg] = STREAM_STYLE[s] || [s, "#304263", "#fff"];
          return `<span class="stream ${(a.streams || []).includes(s) ? "on" : ""}" title="${esc(s)}"><b style="color:${fg};background:${bg}">${esc(txt)}</b></span>`;
        }).join("")
      : '<span class="streams-none">None listed</span>';
    const streamState = (g.streams || []).some((s) => (a.streams || []).includes(s)) ? "match" : "miss";
    const rating = (g.rating || "?").split(" - ")[0];
    const source = g.source.toLowerCase() === "original" ? "original" : g.source;

    const li = el("li", "card" + (correct ? " correct" : ""));
    li.innerHTML = `
      <div class="card-num">${n}</div>
      <div class="card-top">
        <button type="button" class="poster-link" data-zoom="${g.id}" aria-label="Zoom poster"><img class="poster" src="${esc(g.img)}" alt="" loading="lazy" referrerpolicy="no-referrer"></button>
        <div class="card-head">
          <h3 class="card-title" title="${esc(g.title)}">${esc(g.en || g.title)}</h3>
          <div class="card-sub">${esc(g.type)} · ${g.year ?? "?"}</div>
          <div class="tags">${tags}</div>
        </div>
        <div class="cells">
          ${cell("debut", "Debut", g.year ?? "?", c.debut)}
          ${cell("format", "Format", g.type, c.format)}
          ${cell("episodes", "Episodes", fmtEps(g), c.episodes)}
          ${cell("source", "Source", source, c.source)}
          ${cell("studio", "Studio", g.studios.join(", "), c.studio, "wide")}
          ${cell("score", "MAL score", g.score?.toFixed(2) ?? "N/A", c.score)}
          ${cell("pop", "Popularity", "#" + (g.pop ?? "?"), c.pop)}
        </div>
      </div>
      <div class="extras">
        <span class="xchip ${c.seasons.state}">${icon("seasons")}<span class="xl">TV seasons</span> <b>${g.seasons ?? 0}</b> ${badge(c.seasons)}</span>
        <span class="xchip ${heatState}">${icon("heat")}<span class="xl">Similarity</span> <b>${HEAT[heat][0]}</b>
          <span class="heat ${heatState}">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < Math.min(heat + 1, 5) ? "on" : ""}"></i>`).join("")}</span></span>
        <span class="xchip ${c.rating.state}">${icon("rating")}<span class="xl">Rating</span> <b>${esc(rating)}</b> ${badge(c.rating)}</span>
        <span class="xchip ${streamState}"><span class="xl">Streams on</span> ${streams}</span>
      </div>`;
    if (!delayed) li.querySelectorAll(".cell, .xchip").forEach((n) => (n.style.animation = "none"));
    else li.querySelectorAll(".cell, .xchip").forEach((n, i) => (n.style.animationDelay = i * 55 + "ms"));
    return li;
  }

  // Words that are capitalized but aren't names worth hiding.
  const NOT_NAMES = new Set("I A An The But And Or When While After Before As At In On Of For With Without From To Into However Meanwhile Now Yet So If Though Although Despite During Since Until Once Upon His Her Their Its Our My Your He She They It We You This That These Those There Here One Two Three Four Five Six Seven Eight Nine Ten Many Some Every Each Mr Mrs Ms Dr Japanese English".split(" "));

  // One sentence from the synopsis, with the title and every name blacked out.
  function synopsisLine(a) {
    const titleWords = new Set();
    [a.title, a.en, ...(a.alt || [])].filter(Boolean).forEach((t) =>
      norm(t).split(" ").forEach((w) => { if (w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)) titleWords.add(w); })
    );
    // Protect initials and titles like "Monkey D. Luffy" / "Mr. Smith" from being read as sentence ends.
    const text = (a.synopsis || "No synopsis available.").replace(/(?<![\p{L}])(\p{Lu}|Mr|Mrs|Ms|Dr|St|Jr|vs)\.(?=\s)/gu, "$1․");
    const sentences = (text.match(/[^.!?]+[.!?]+["')\]]*/g) || [text]).map((x) => x.trim().replace(/․/g, "."));
    const line = sentences.find((x) => x.split(/\s+/).length >= 8) || sentences[0] || "";
    // Capitalized words seen mid-sentence anywhere in the synopsis are names, even when one starts our line.
    const midCaps = new Set();
    for (const sen of sentences) sen.split(/\s+/).slice(1).forEach((w) => {
      const core = w.replace(/^[^\p{L}]+|(?:['’]s)?[^\p{L}]*$/gu, "");
      if (/^\p{Lu}/u.test(core)) midCaps.add(core);
    });
    const tokens = line.split(/(\s+|[—–\/]|\.{3}|…)/);
    let first = true;
    return tokens.map((tok, i) => {
      if (!tok || /^(\s+|[—–\/]|\.{3}|…)$/.test(tok)) return esc(tok);
      const m = tok.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}][\p{L}\p{N}'’.-]*?)((?:['’]s)?[^\p{L}\p{N}]*)$/u);
      const isFirst = first;
      first = false;
      if (!m) return esc(tok);
      const [, pre, word, post] = m;
      const capital = /^\p{Lu}/u.test(word);
      const nextCapital = /^[^\p{L}]*\p{Lu}/u.test(tokens[i + 2] || "");
      const isName = capital && !NOT_NAMES.has(word) && (!isFirst || nextCapital || midCaps.has(word));
      const hide = isName || titleWords.has(norm(word));
      return esc(pre) + (hide ? `<span class="redact">${"█".repeat(Math.min(word.length, 10))}</span>` : esc(word)) + esc(post);
    }).join("");
  }

  const HINTS = {
    tags: "Tags",
    recs: "Fans also liked",
    synopsis: "Synopsis",
    letter: "First letter",
    poster: "Blurred poster",
  };
  // Hints from older saves
  const LEGACY_HINT = { premise: "synopsis", genres: "tags" };
  const hintName = (kind) => HINTS[LEGACY_HINT[kind] || kind] || kind;

  function hintCard(kind, a, n) {
    kind = LEGACY_HINT[kind] || kind;
    const li = el("li", "card hintcard");
    let body = "";
    if (kind === "synopsis") {
      body = `<div class="hint-body">${synopsisLine(a)}</div>`;
    } else if (kind === "poster") {
      body = `<div class="hint-poster-wrap"></div>`;
    } else if (kind === "letter") {
      const name = (a.en || a.title).trim();
      body = `<div class="hint-body">The title starts with <span class="hint-letter">${esc(name[0].toUpperCase())}</span></div>`;
    } else if (kind === "recs") {
      const recs = (a.recs || []).filter((r) => {
        const other = byId.get(r.id);
        return r.id !== a.id && !(other && other.franchise === a.franchise);
      }).slice(0, 3);
      body = recs.length
        ? `<div class="tags">${recs.map((r) => `<span class="tag rec">${esc(r.name)}</span>`).join("")}</div>`
        : '<div class="hint-body">No recommendations listed for this one.</div>';
    } else {
      const tags = (a.tags && a.tags.length ? a.tags : [...(a.genres || []), ...(a.themes || [])]).slice(0, 8);
      body = `<div class="tags">${tags.map((t) => `<span class="tag on">${esc(t)}</span>`).join("")}</div>`;
    }
    li.innerHTML = `<div class="card-num">${n}</div><div class="hint-eyebrow">Hint · ${esc(HINTS[kind] || kind)}</div>${body}`;
    if (kind === "poster") li.querySelector(".hint-poster-wrap").append(blurredPoster(a.img));
    return li;
  }

  // Draw the poster into a tiny canvas so the sharp image never ends up in the page
  // (an <img> can be dragged or opened to see it unblurred).
  const posterCache = new Map();
  function blurredPoster(src) {
    const c = document.createElement("canvas");
    c.className = "hint-poster";
    c.width = 14;
    c.height = 20;
    const paint = (img) => c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    if (posterCache.has(src)) paint(posterCache.get(src));
    else {
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.onload = () => { posterCache.set(src, img); paint(img); };
      img.src = src;
    }
    return c;
  }

  function render(fresh = false) {
    const a = byId.get(game.answer);
    const n = used();

    // counter + pips
    $("#guessNum").textContent = game.over ? `${n} of ${MAX_GUESSES}` : `${Math.min(n + 1, MAX_GUESSES)} of ${MAX_GUESSES}`;
    const pips = $("#pips");
    pips.innerHTML = "";
    for (let i = 0; i < MAX_GUESSES; i++) {
      const t = game.turns[i];
      const p = el("span", "pip");
      if (HINT_AT.includes(i + 1)) p.classList.add("hintslot");
      if (t) p.classList.add(t.hint ? "hint" : t.id === game.answer ? "win" : "used");
      pips.append(p);
    }

    // hint button
    const hb = $("#hintBtn");
    const avail = !game.over && hintAvailable();
    hb.disabled = !avail;
    hb.classList.toggle("ready", avail);
    const nextLock = HINT_AT.find((x) => x > n + 1);
    $("#hintLabel").textContent = avail ? "Pick a hint" : game.over ? "Hints" : nextLock && hintsUsed() < HINT_AT.length ? `Hint at guess ${nextLock}` : "No hints left";
    if (!avail && $("#hintPicker").open) $("#hintPicker").close();
    const usedKinds = new Set(game.turns.filter((t) => t.hint).map((t) => LEGACY_HINT[t.hint] || t.hint));
    document.querySelectorAll(".hint-opt").forEach((b) => (b.disabled = usedKinds.has(b.dataset.hint)));

    $("#giveUpBtn").disabled = game.over;
    const input = $("#searchInput");
    input.disabled = game.over;
    input.placeholder = game.over ? "Round over — click Next anime to keep playing" : "Search for an anime...";
    if (game.over) { input.value = ""; closeSuggestions(); }

    // guesses (newest first)
    const list = $("#guesses");
    const prev = list.children.length;
    list.innerHTML = "";
    game.turns.forEach((t, i) => {
      const isNew = !fresh && i === n - 1 && n > prev - 0;
      const node = t.hint ? hintCard(t.hint, a, i + 1) : guessCard(byId.get(t.id), a, i + 1, isNew);
      if (!isNew) node.style.animation = "none";
      list.prepend(node);
    });

    // result banner
    const res = $("#result");
    if (game.over) {
      res.hidden = false;
      res.className = "card result" + (game.won ? " correct" : " lost");
      const tags = [...(a.genres || []), ...(a.themes || [])].map((t) => `<span class="tag">${esc(t)}</span>`).join("");
      res.innerHTML = `
        <div class="card-top">
          <button type="button" class="poster-link" data-zoom="${a.id}" aria-label="Zoom poster"><img class="poster" src="${esc(a.img)}" alt="" referrerpolicy="no-referrer"></button>
          <div class="card-head">
            <div class="result-eyebrow">${game.won ? `Solved in ${n} ${n === 1 ? "guess" : "guesses"}` : "The anime was"}</div>
            <h3 class="card-title" title="${esc(a.title)}">${esc(a.en || a.title)}</h3>
            <div class="card-sub">${esc(a.title !== (a.en || a.title) ? a.title + " · " : "")}${esc(a.type)} · ${a.year ?? "?"} · ${esc(a.studios.join(", "))} · ★ ${a.score ?? "N/A"} · #${a.pop} popular</div>
            ${tags ? `<div class="tags">${tags}</div>` : ""}
          </div>
          <div class="result-actions">
            <button class="cta primary" id="nextBtn">Next anime →</button>
            <a href="${malUrl(a)}" target="_blank" rel="noopener">View on MAL ↗</a>
          </div>
        </div>`;
      $("#nextBtn").onclick = newGame;
    } else {
      res.hidden = true;
    }

    $("#roundNum").textContent = store.get("round:" + mode, 1);
    $("#streakNum").textContent = getStats().streak;
    $("#footMsg").textContent = game.over ? (game.won ? "Nice. Another one?" : "Tough one. Another?") : `${MODES[mode].label} · unlimited rounds`;
  }

  // ---------- autocomplete ----------
  let suggestions = [];
  let active = 0;

  function closeSuggestions() {
    $("#suggestions").hidden = true;
    suggestions = [];
  }

  function highlight(name, q) {
    const needle = q.trim().toLowerCase();
    const i = name.toLowerCase().indexOf(needle);
    if (!needle || i < 0) return esc(name);
    return esc(name.slice(0, i)) + "<mark>" + esc(name.slice(i, i + needle.length)) + "</mark>" + esc(name.slice(i + needle.length));
  }

  function showSuggestions() {
    const q = $("#searchInput").value;
    $("#searchClear").hidden = !q;
    const box = $("#suggestions");
    if (!q.trim() || game.over) return closeSuggestions();
    suggestions = search(q, guessIds());
    active = 0;
    box.innerHTML = "";
    if (!suggestions.length) {
      box.append(el("li", "sugg-empty", `No match in the top ${DATA.length}. Try another name.`));
    }
    suggestions.forEach((s, i) => {
      const a = s.a;
      const main = a.en || a.title;
      const alt = s.hit && s.hit !== main ? s.hit : a.title !== main ? a.title : "";
      const li = el("li", "sugg" + (i === active ? " active" : ""));
      li.setAttribute("role", "option");
      li.innerHTML = `<img src="${esc(a.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        <div><div class="sugg-title">${highlight(main, q)}</div>${alt ? `<div class="sugg-alt">${highlight(alt, q)}</div>` : ""}</div>
        <div class="sugg-meta">${esc(a.type)}</div>`;
      li.addEventListener("mousedown", (e) => { e.preventDefault(); choose(i); });
      li.addEventListener("mousemove", () => setActive(i));
      box.append(li);
    });
    box.hidden = false;
  }

  function setActive(i) {
    active = (i + suggestions.length) % suggestions.length;
    [...$("#suggestions").children].forEach((n, j) => n.classList.toggle("active", j === active));
    $("#suggestions").children[active]?.scrollIntoView({ block: "nearest" });
  }

  function choose(i) {
    const s = suggestions[i];
    if (!s) return;
    $("#searchInput").value = "";
    $("#searchClear").hidden = true;
    closeSuggestions();
    submitGuess(s.a.id);
    if (!game.over) $("#searchInput").focus();
  }

  // ---------- stats modal ----------
  function openStats() {
    const s = getStats();
    $("#statsMode").textContent = MODES[mode].label;
    $("#statRow").innerHTML = [
      ["Played", s.played],
      ["Win %", s.played ? Math.round((s.wins / s.played) * 100) : 0],
      ["Streak", s.streak],
      ["Best", s.best],
    ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join("");
    const max = Math.max(1, ...s.dist);
    $("#dist").innerHTML = s.dist.map((v, i) =>
      `<div class="dist-row"><span>${i + 1}</span><div class="dist-bar ${s.last === i + 1 ? "last" : ""}" style="width:${Math.max(6, (v / max) * 100)}%">${v}</div></div>`
    ).join("");
    $("#statsModal").showModal();
  }

  // ---------- poster zoom ----------
  function openZoom(id) {
    const a = byId.get(id);
    if (!a) return;
    // MAL serves a bigger version of the same poster with an "l" suffix
    const big = a.img.replace(/(\.\w+)$/, "l$1");
    const img = $("#zoomImg");
    img.onerror = () => { img.onerror = null; img.src = a.img; };
    img.src = big;
    $("#zoomTitle").textContent = a.en || a.title;
    $("#zoomLink").href = malUrl(a);
    $("#zoomModal").showModal();
  }

  // ---------- history modal ----------
  let historyFilter = "all";

  function openHistory() {
    const all = store.get("history", []).slice().reverse();
    const rows = all.filter((h) => historyFilter === "all" || h.mode === historyFilter);
    document.querySelectorAll(".hist-tab").forEach((b) => b.classList.toggle("on", b.dataset.filter === historyFilter));
    const wins = rows.filter((h) => h.won).length;
    $("#histSummary").textContent = rows.length
      ? `${rows.length} round${rows.length === 1 ? "" : "s"} · ${wins} solved · ${Math.round((wins / rows.length) * 100)}% win rate`
      : "No finished rounds yet. Go play one!";
    const list = $("#histList");
    list.innerHTML = "";
    for (const h of rows.slice(0, 300)) {
      const a = byId.get(h.answer);
      if (!a) continue;
      const n = h.turns.length;
      const when = new Date(h.at);
      const name = (id) => { const g = byId.get(id); return g ? g.en || g.title : "Unknown"; };
      const pips = h.turns.map((t) =>
        t.hint ? `<i class="hp hint" title="Hint: ${esc(hintName(t.hint))}"></i>` : `<i class="hp ${t.id === h.answer ? "win" : ""}" title="${esc(name(t.id))}"></i>`
      ).join("");
      const guesses = h.turns.map((t, i) =>
        t.hint ? `<li class="hint">${i + 1}. Hint · ${esc(hintName(t.hint))}</li>` : `<li class="${t.id === h.answer ? "win" : ""}">${i + 1}. ${esc(name(t.id))}</li>`
      ).join("") || "<li>No guesses (gave up right away)</li>";
      const li = el("li", "hist-row");
      li.innerHTML = `
        <details>
          <summary>
            <img src="${esc(a.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">
            <div class="hist-main">
              <div class="hist-title">${esc(a.en || a.title)}</div>
              <div class="hist-meta">${MODES[h.mode]?.label.split(" · ")[0] || "Regular"} · ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
              <div class="hist-pips">${pips}</div>
            </div>
            <span class="hist-result ${h.won ? "won" : "lost"}">${h.won ? `${n}/${MAX_GUESSES}` : "X"}</span>
          </summary>
          <ol class="hist-guesses">${guesses}</ol>
          <a class="hist-link" href="${malUrl(a)}" target="_blank" rel="noopener">View on MAL ↗</a>
        </details>`;
      list.append(li);
    }
    if (!$("#historyModal").open) $("#historyModal").showModal();
  }

  // ---------- backdrop ----------
  function buildCollage() {
    const c = $("#collage");
    const imgs = DATA.slice(0, 200).map((a) => a.img).filter(Boolean).sort(() => Math.random() - 0.5).slice(0, 100);
    imgs.forEach((src) => {
      const d = el("div");
      d.style.backgroundImage = `url("${src}")`;
      c.append(d);
    });
  }

  // ---------- wiring ----------
  function setMode(m) {
    if (!MODES[m] || m === mode) return;
    mode = m;
    store.set("mode", m);
    document.querySelectorAll(".mode").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === m)));
    if ($("#hintPicker").open) $("#hintPicker").close();
    loadOrNew();
  }

  function init() {
    if (!DATA.length) {
      $("#panel").innerHTML = '<p style="padding:20px">No anime data found. Run <code>python scripts/scrape.py</code> first.</p>';
      return;
    }
    $("#dataDate").textContent = `${DATA.length} anime · updated ${window.ANIME_DATA_UPDATED || "?"}`;
    buildCollage();
    document.querySelectorAll(".mode").forEach((b) => {
      b.setAttribute("aria-checked", String(b.dataset.mode === mode));
      b.addEventListener("click", () => setMode(b.dataset.mode));
    });

    const input = $("#searchInput");
    input.addEventListener("input", showSuggestions);
    input.addEventListener("focus", showSuggestions);
    input.addEventListener("blur", () => setTimeout(closeSuggestions, 120));
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
      else if (e.key === "Enter") { e.preventDefault(); choose(active); }
      else if (e.key === "Escape") { closeSuggestions(); }
    });
    $("#searchClear").addEventListener("click", () => { input.value = ""; showSuggestions(); input.focus(); });

    let giveUpTimer = null;
    $("#giveUpBtn").addEventListener("click", () => {
      const btn = $("#giveUpBtn");
      if (game.over) return;
      if (game.turns.length && !btn.classList.contains("confirm")) {
        btn.classList.add("confirm");
        btn.textContent = "Sure?";
        clearTimeout(giveUpTimer);
        giveUpTimer = setTimeout(() => { btn.classList.remove("confirm"); btn.textContent = "Give up"; }, 2500);
        return;
      }
      clearTimeout(giveUpTimer);
      btn.classList.remove("confirm");
      btn.textContent = "Give up";
      finish(false);
      save();
      render();
    });
    $("#hintBtn").addEventListener("click", () => $("#hintPicker").showModal());
    document.querySelectorAll(".hint-opt").forEach((b) =>
      b.addEventListener("click", () => { $("#hintPicker").close(); useHint(b.dataset.hint); })
    );
    $("#helpBtn").addEventListener("click", () => $("#helpModal").showModal());
    $("#statsBtn").addEventListener("click", openStats);
    $("#historyBtn").addEventListener("click", openHistory);
    document.addEventListener("click", (e) => {
      const z = e.target.closest("[data-zoom]");
      if (z) openZoom(Number(z.dataset.zoom));
    });
    $("#zoomModal").addEventListener("click", (e) => { if (e.target === $("#zoomModal")) $("#zoomModal").close(); });
    document.querySelectorAll(".hist-tab").forEach((b) =>
      b.addEventListener("click", () => { historyFilter = b.dataset.filter; openHistory(); })
    );
    $("#clearHistory").addEventListener("click", () => {
      if (!confirm("Delete your whole game history? Stats are kept.")) return;
      store.set("history", []);
      openHistory();
    });
    $("#resetStats").addEventListener("click", () => {
      if (!confirm("Reset stats for this mode?")) return;
      store.set("stats:" + mode, null);
      openStats();
      render(true);
    });
    $("#logo").addEventListener("click", (e) => { e.preventDefault(); if (game.over) newGame(); });

    document.addEventListener("keydown", (e) => {
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "/" && document.activeElement !== input && !game.over) {
        e.preventDefault();
        input.focus();
      }
    });

    loadOrNew();
    if (!store.get("seenHelp", false)) { store.set("seenHelp", true); $("#helpModal").showModal(); }
  }

  init();
})();
