<!-- Verification Summary -->

## COMPLETED: Backend Congestion Model + Data Sources Endpoint

### What was built:

1. **`server/congestion.py`** (365 lines)
   - Fetches real City of Calgary traffic incidents (Socrata API)
   - Computes per-edge congestion level (0–1) combining:
     * Typical-by-hour heuristic (weekday peaks 07–09, 16–18; weekend flatter)
     * Live incident boost (±0.5–0.8 within ~250 m, linear decay)
   - 5-minute cache on incidents; stale fallback on fetch failure
   - Never crashes the server (all errors caught)
   - Uses stdlib only: `urllib`, `datetime`, `zoneinfo`

2. **`server/server.py`** (modified)
   - Added `--port` CLI arg (default 8765)
   - Two new endpoints:
     * `GET /congestion.json` – per-edge levels + live incidents
     * `GET /sources.json` – data attribution metadata (9 sources)
   - Loads `web/scene.json` on startup for road data
   - CORS `*` on both routes

3. **`server/README.md`** (documentation)
   - Endpoint specs with request/response examples
   - Congestion model description
   - Data sources list with licences
   - Example workflows and testing instructions

### Verification Results (port 8766):

**Real data facts verified**:
- ✓ City of Calgary Current Traffic Incidents API: working
- ✓ Real incident fetched: "Shawville Gate and Somervale Co SW" 
  - Lat/Lon: 50.8981, -114.0701
  - Snapped to SUMO: x=1952.2, y=-15308.5 (outside downtown [0,0,2452,1849])
- ✓ 1 incident in dataset (at time of testing); 0 inside downtown bounds; 1 outside

**Endpoint Tests (curl)**:

1. **GET /congestion.json**
   ```
   200 OK
   - updated: 2026-10-02T15:53:17.192279+00:00 (ISO 8601, fresh)
   - stale: false (live data)
   - hour: 9 (local Edmonton time)
   - isWeekday: true
   - incidents: 1 (with full metadata)
   - edges: 557 edges with level >= 0.05
   - Top 5 congested: -1269868035#0 (0.40), -1270794198#0 (0.40), etc.
   ```

2. **GET /sources.json**
   ```
   200 OK
   - generated: 2026-10-02T15:53:19.248639+00:00
   - sources: 9 entries (live, static, modelled, placeholder)
   - All with proper licence, attribution, status, note
   - Includes: Calgary incidents, OSM, SUMO, typical-by-hour model, 
     three.js, cameras (not used), Alberta 511 (not used)
   ```

3. **GET /stream** (existing)
   ```
   200 OK text/event-stream
   - Frame data: vehicles, TLS states, stats (verified working)
   ```

### Files Created/Modified:

| Path | Action | Purpose |
|------|--------|---------|
| `server/congestion.py` | Created (365 lines) | Congestion model + incident fetch |
| `server/server.py` | Modified | Added endpoints + --port arg |
| `server/README.md` | Created (270 lines) | Full documentation |

### Data Honesty Checklist:

✓ Typical-by-hour model: marked as "modelled assumption", NOT measured
✓ SUMO defaults: marked as "placeholder" (not Calgary real plans)
✓ Building heights: noted fraction from OSM vs pseudo-random (fallback)
✓ Incidents outside bounds: correctly included + coordinates reported
✓ Stale flag: set on fetch failure, documented
✓ All 9 sources: listed with correct status (live/static/modelled/placeholder/available-not-used)
✓ Disclaimer: "per-street speeds are NOT live data" on /congestion.json

### Notes on Unverified Aspects:

**Not verified because data is real-time / would require running overnight**:
- Weekend congestion levels (current test is weekday)
- Incident boost decay curve (only 1 incident available to test)
- Stale flag behavior on API failure (would require blocking API)

**Legitimately outside downtown bounds**:
- Current incident at (1952.2, -15308.5) is outside [0, 2452] × [0, 1849]
- This is correct: Shawville is in SW Calgary, outside downtown area
- System correctly reports incident + coordinates; simply not affecting downtown edges

### Real Paths:

- Server module: `C:/Users/15874/Documents/TrafficTests/calgary3d/server/`
- Scene data: `C:/Users/15874/Documents/TrafficTests/calgary3d/web/scene.json`
- Python: `C:/Users/15874/AppData/Local/hermes/tools/python-3.14.7+20260901-win32-x64/python.exe`

### Next Steps (not required for this task):

- Connect web/app.js to display /congestion.json edges on 3D map
- Add edge name lookup to show street names in congestion view
- Test with multiple incidents to verify boost decay

