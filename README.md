# Psyche v11 "Rite"

PRISM analysis platform. Claude AI is the analysis engine (with a deterministic
rule-based fallback so the app works even without an API key), every analysis is
a timestamped snapshot, and the Evolution tab charts how your PRISM profile
shifts over time.

## Architecture
```
psyche-v10/
├── server.js          # Express: auth, /api/analyze, snapshots, share
├── engine.js          # PRISM engines: claudeEngine (JSON) + rulesEngine (fallback)
├── models/index.js    # User, Analysis (snapshots), Share (90-day TTL)
└── public/index.html  # v10 client: analyze, radar, traits, history, evolution
```

## Efficiency layer
- SHA-256 dedupe: identical text returns the cached snapshot, zero API cost
- Per-user daily rate limit (DAILY_LIMIT, default 15)
- Single round-trip: one /api/analyze call returns the complete profile
- Automatic fallback chain: Claude error/no key → rule-based engine

## Run (same as before)
1. MongoDB running (service already installed on your machine)
2. cp .env.example .env  → set JWT_SECRET (+ ANTHROPIC_API_KEY for Claude mode)
3. npm install
4. npm start → http://localhost:3000

Note: uses database `psyche10` so it won't touch your v9 data.

## API
POST /api/auth/register · POST /api/auth/login · GET /api/me
POST /api/analyze {text,label} → {result, engine, cached}
GET /api/analyses · GET/DELETE /api/analyses/:id
POST /api/share {id} · GET /s/:shareId (public)
