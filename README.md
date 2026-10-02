# Calgary SUMO 3D Drone Traffic Simulation

A real-time 3D traffic simulation of Calgary's road network using SUMO (Simulation of Urban MObility) and three.js, with live incident data from the City of Calgary's open data portal.

## Features

- **Real road network** from OpenStreetMap (Calgary downtown and surrounding areas)
- **Live traffic incidents** from City of Calgary Current Traffic Incidents dataset (refresh ~10 min)
- **3D drone-view visualization** with three.js — fly, orbit, and inspect the city
- **Speed-coloured vehicles** — red (stopped) → yellow → green (free flow)
- **Per-street congestion colouring** — typical-by-hour heuristic + incident boosts
- **Day/night cycle** with building lights and vehicle headlights
- **Interactive control panel** — playback rate, demand scaling, signal control, edge closure
- **SSE streaming API** — real-time vehicle positions, signal states, and statistics
- **Zero API keys required** — runs entirely on public open data

## Requirements

- **Python 3.14** with the `sumolib`/`traci` package that ships with **SUMO 1.27.1**
- A modern browser with **WebGL** support (Chrome, Firefox, Edge, Safari)
- No API keys, no registration, no external services

## How to Run

### Option 1: One-click (Windows)
Double-click `start_3d.bat` — it launches the SUMO backend and opens the browser.

### Option 2: Manual
```bash
# Terminal 1: Start the backend (SSE on port 8765)
python server/server.py

# Terminal 2: Open the viewer
# http://localhost:8765/
```

The backend serves the three.js frontend at `/` and the SSE stream at `/stream`.

## Controls (three.js viewer)

| Action | Control |
|--------|---------|
| Fly camera | Click the scene to capture the mouse, then look around |
| Move forward/back/left/right | W / S / A / D |
| Move down / up | Q / E |
| Boost speed | Hold **Shift** |
| Adjust fly speed | Scroll wheel |
| Orbit mode (toggle) | **C** — drag to orbit, scroll to zoom |
| Cinematic auto-orbit | **O** |
| Open/close control panel | **Tab** |
| Release the mouse | **Esc** |
| Close / reopen a road | Double-click a road segment |

## Control Panel Toggles

- **playbackRate** — simulation speed multiplier (0.1× – 10×)
- **speedScale** — vehicle speed visual multiplier
- **demandScale** — vehicle demand multiplier (affects randomTrips generation)
- **signalMode** — `normal` / `allRed` / `allGreen` / `flashing`
- **closeEdges** — click a road in the panel to close it; click again to reopen
- **reset** — restart simulation from time 0
- **day/night** — toggle time-of-day lighting

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/stream` | GET (SSE) | Per-frame vehicle positions, signal states, summary stats |
| `/control` | POST | Send control commands (playbackRate, demandScale, signalMode, closeEdges, reset) |
| `/congestion.json` | GET | Current per-edge congestion levels (0–1) and incident boosts |
| `/sources.json` | GET | Data provenance manifest (see below) |

### `/stream` Event Format
Each Server-Sent Event is one `data:` line of compact JSON. Coordinates are SUMO
metres (x east, y north) in the network's own frame, `angle` is degrees clockwise
from north, and speeds are m/s.

```json
{"t":1286.5,
 "v":[[2938,818.1,997.5,90.5,0.0],[2945,1030.1,965.1,182.4,0.0]],
 "tls":{"11013329563":"GGrr"},
 "stats":{"n":412,"meanSpeed":8.2,"halting":31,
          "control":{"playbackRate":1.0,"speedScale":1.0,"demandScale":1.0,
                     "signalMode":"normal","closeEdges":[]}}}
```

`v` rows are `[vehicleId, x, y, angleDeg, speedMs]`. `tls` carries only the
signals whose state changed since the previous frame, plus a full dump every 20
frames.

### `/control` Payload Example
```json
{"playbackRate": 2.0, "demandScale": 1.5, "signalMode": "allGreen"}
```

## Data Provenance — Read This First

**The ONLY live data in this simulation is the City of Calgary Current Traffic Incidents dataset.**
- Source: `data.calgary.ca` dataset **4jah-h97u**
- Licence: **Open Government Licence – City of Calgary**
- Refresh: approximately every 10 minutes
- Used: incident locations, types, and descriptions → visual markers + local congestion boosts

**Everything else is simulated / modelled, not measured:**

| Component | Source | Nature |
|-----------|--------|--------|
| Vehicle demand | SUMO `randomTrips` | **Random placeholder** — NOT real Calgary traffic counts |
| Signal timings | `netconvert` actuated defaults | **NOT** Calgary's real signal plans |
| Building heights | OSM `height` / `building:levels` tags where present; otherwise **pseudo-random 10–45 m** |
| Per-street congestion colouring | Typical-by-hour heuristic model + incident proximity boosts | **ESTIMATE** — NOT measured speed data |
| Road network, street names, building footprints, parks, water | OpenStreetMap (Overpass snapshot **2026-10-01**) | Licensed **ODbL** — © OpenStreetMap contributors |

**No free live per-street speed feed exists for Calgary.** Google, TomTom, and HERE all require paid API keys. The congestion colours you see are a heuristic model, not ground truth.

## Attribution & Licences

This repository **redistributes ODbL-licensed data** from OpenStreetMap.

| Component | Licence | Credit |
|-----------|---------|--------|
| Road network, street names, building footprints, parks, water | **ODbL 1.0** | **© OpenStreetMap contributors** — snapshot via Overpass 2026-10-01 |
| City of Calgary Current Traffic Incidents | **Open Government Licence – City of Calgary** | The City of Calgary |
| SUMO (simulation engine) | **EPL-2.0** | Eclipse SUMO project |
| three.js (3D renderer) | **MIT** | three.js authors |
| Project code (this repo) | **MIT** | Copyright (c) 2026 Semir Haji |

See `LICENSE` for the project's MIT licence text. Upstream credits are in the
table above and in the Data Provenance section.

## Project Structure

```
calgary3d/
  server/
    server.py        # TraCI + SSE backend (port 8765)
    export_scene.py  # Exports SUMO network to three.js scene.json
    congestion.py    # Congestion heuristic + incident boost
  web/
    index.html       # three.js viewer entry point
    app.js           # Viewer logic, controls, SSE client
    style.css        # UI styling
    scene.json       # Exported 3D scene (roads, buildings, water, parks)
  data/
    sources_verified.json  # Data provenance manifest (served at /sources.json)
  start_3d.bat       # Windows one-click launcher
calgary/
  dt.osm, dt.net.xml, dt.rou.xml, dt.poly.xml, dt.sumocfg  # SUMO model from OSM
sim/                   # Older synthetic SUMO test outputs
agent-tests/           # Logs from four original agent tests
```

## Known Limitations

- Traffic demand is randomly generated, so congestion patterns are plausible but
  not a reproduction of a real Calgary commute.
- Signal timings are simulator defaults, so junction behaviour will not match
  what Calgary's signals actually do.
- The congestion colouring is an estimate (see Data Provenance), not measured
  speeds.
- The congestion layer and the Data Sources panel load as separate frontend
  modules; if `/congestion.json` is unavailable the layer falls back to bundled
  mock data and labels itself MOCK in the interface.
- Built and verified on Windows. `start_3d.bat` is Windows-only; the Python
  commands work anywhere SUMO 1.27.1 is installed.

## Author

**Semir Haji** — semirhaji07@gmail.com — GitHub: [@semirhaji](https://github.com/semirhaji)