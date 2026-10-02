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
| Fly camera | Click + drag (mouse look) |
| Move forward/back/left/right | W / S / A / D |
| Move down / up | Q / E |
| Boost speed | Hold **Shift** |
| Adjust fly speed | Scroll wheel |
| Orbit mode (toggle) | **C** — click a point to orbit around it |
| Cinematic auto-orbit | **O** |
| Open/close control panel | **Tab** |
| Release mouse (orbit/fly) | **Esc** |
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
```json
{
  "time": 123.45,
  "vehicles": [
    {"id": "veh_0", "x": -114.07, "y": 51.04, "speed": 13.2, "angle": 45, "type": "passenger"}
  ],
  "signals": [
    {"id": "cluster_12", "state": "G", "nextChange": 12.3}
  ],
  "stats": {"vehicleCount": 412, "avgSpeed": 11.7, "incidentCount": 3}
}
```

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

See `LICENSE` for the project's MIT licence text and `NOTICE` for upstream credits.

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

## Author

**Semir Haji** — semirhaji07@gmail.com — GitHub: [@semirhaji](https://github.com/semirhaji)