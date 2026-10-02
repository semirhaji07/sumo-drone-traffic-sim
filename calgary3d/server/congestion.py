#!/usr/bin/env python3
"""Congestion model: fetch live incidents + compute per-edge congestion levels.

Fetches City of Calgary Current Traffic Incidents from Socrata API.
Computes congestion level per edge based on:
  - Typical-by-hour model (weekday/weekend, time-of-day heuristic)
  - Incident boost (edges near incident points)

Output: per-edge congestion level 0..1 (only level >= 0.05 reported).
Caching: 5-min cache on incidents, stale flag on fetch failure.
Never crashes the server: all failures are caught and logged.
"""

import json
import time
import math
import threading
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

# Try to get Alberta timezone; fall back to fixed UTC-6 if tzdata unavailable
try:
    CALGARY_TZ = ZoneInfo('America/Edmonton')
except Exception:
    # Fallback: fixed UTC-6 (always, no DST simulation)
    CALGARY_TZ = timezone(timedelta(hours=-6))

SOCRATA_URL = "https://data.calgary.ca/resource/4jah-h97u.json"
FETCH_TIMEOUT_S = 10
CACHE_TTL_S = 300  # 5 minutes

# Thread-safe cache
_cache_lock = threading.Lock()
_cache = {
    'incidents': [],
    'fetched_at': 0,
    'stale': False,
    'error': None,
}


def _point_to_line_distance(px, py, x1, y1, x2, y2):
    """Perpendicular distance from point (px, py) to line segment (x1,y1)-(x2,y2)."""
    dx = x2 - x1
    dy = y2 - y1
    len_sq = dx * dx + dy * dy
    if len_sq < 1e-9:
        return math.sqrt((px - x1) ** 2 + (py - y1) ** 2)
    
    t = max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / len_sq))
    closest_x = x1 + t * dx
    closest_y = y1 + t * dy
    return math.sqrt((px - closest_x) ** 2 + (py - closest_y) ** 2)


def _nearest_distance_to_edge_shape(px, py, shape):
    """Nearest perpendicular distance from point to edge polyline."""
    if len(shape) < 2:
        return float('inf')
    
    min_dist = float('inf')
    for i in range(len(shape) - 1):
        x1, y1 = shape[i]
        x2, y2 = shape[i + 1]
        dist = _point_to_line_distance(px, py, x1, y1, x2, y2)
        min_dist = min(min_dist, dist)
    return min_dist


def _is_severe_incident(incident_type):
    """Return True if incident is closure/accident (higher boost), else construction/info."""
    if not incident_type:
        return False
    lower = incident_type.lower()
    return any(kw in lower for kw in ['closure', 'closed', 'accident', 'collision', 'crash', 'hazard'])


def _typical_by_hour(hour, is_weekend, road_class_level):
    """Estimate typical congestion for a given hour (local time).
    
    Args:
        hour: 0..23 (local time, America/Edmonton)
        is_weekend: bool
        road_class_level: 0=local (lower), 1=major (higher)
    
    Returns:
        Congestion level 0..1 (assumption, not measured data).
    """
    # Very rough heuristic:
    # - Weekday peaks: 07-09 (morning), 16-18 (evening)
    # - Midday: moderate
    # - Night: low
    # - Weekend: flatter
    
    if is_weekend:
        # Weekend: low baseline, slight rise midday
        if 10 <= hour < 18:
            return 0.25 + 0.1 * (road_class_level - 0.5)
        else:
            return 0.1 + 0.05 * (road_class_level - 0.5)
    else:
        # Weekday
        if 7 <= hour < 9:  # Morning peak
            return 0.6 + 0.15 * (road_class_level - 0.5)
        elif 16 <= hour < 18:  # Evening peak
            return 0.65 + 0.15 * (road_class_level - 0.5)
        elif 9 <= hour < 16:  # Midday
            return 0.35 + 0.1 * (road_class_level - 0.5)
        else:  # Night
            return 0.1 + 0.05 * (road_class_level - 0.5)


def _fetch_incidents():
    """Fetch current incidents from City of Calgary Socrata API.
    
    Returns: list of dicts with keys:
      - incident_info (str): location/description
      - description (str): detail
      - start_dt_utc (str): ISO8601
      - modified_dt_utc (str): ISO8601
      - quadrant (str): NE, NW, SE, SW, or empty
      - latitude (float)
      - longitude (float)
    """
    try:
        req = urllib.request.Request(SOCRATA_URL)
        req.add_header('User-Agent', 'calgary-traffic-sim/1.0')
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_S) as response:
            data = json.loads(response.read().decode('utf-8'))
            return list(data) if isinstance(data, list) else []
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, Exception) as e:
        return None


def refresh_cache():
    """Fetch fresh incidents if cache expired. Called by server before returning data."""
    global _cache
    
    with _cache_lock:
        now = time.time()
        if now - _cache['fetched_at'] < CACHE_TTL_S:
            # Cache still fresh
            return
        
        # Try to fetch
        incidents = _fetch_incidents()
        _cache['fetched_at'] = now
        
        if incidents is not None:
            _cache['incidents'] = incidents
            _cache['stale'] = False
            _cache['error'] = None
        else:
            # Fetch failed: keep last incidents, set stale flag
            _cache['stale'] = True


def compute_congestion(roads, net_offset):
    """Compute per-edge congestion level.
    
    Args:
        roads: list of dicts with keys id, name, lanes, speed (m/s), shape [[x,y]...]
        net_offset: tuple (x_offset, y_offset) for OSM->SUMO conversion
    
    Returns: dict {
        'updated': ISO8601 timestamp,
        'stale': bool (True if last fetch failed),
        'hour': int (local hour 0..23),
        'isWeekday': bool,
        'mode': str (description of model),
        'incidents': [ {id, type, desc, x, y, lat, lon, started, modified} ],
        'edges': { '<edgeId>': level, ... }  (only level >= 0.05),
        'disclaimer': str
    }
    """
    refresh_cache()
    
    now_utc = datetime.now(timezone.utc)
    now_local = now_utc.astimezone(CALGARY_TZ)
    hour = now_local.hour
    is_weekday = now_local.weekday() < 5  # Mon-Fri
    
    with _cache_lock:
        incidents = list(_cache['incidents'])
        stale = _cache['stale']
    
    # Convert lat/lon to SUMO coords for incidents
    from export_scene import latlon_to_xy
    
    incident_points = []
    for inc in incidents:
        try:
            lat = float(inc.get('latitude', 0))
            lon = float(inc.get('longitude', 0))
            if lat == 0 and lon == 0:
                continue  # Skip invalid coords
            
            x, y = latlon_to_xy(lat, lon, net_offset)
            
            inc_type = inc.get('incident_info', '').split()[0] if inc.get('incident_info') else ''
            incident_points.append({
                'x': x,
                'y': y,
                'lat': lat,
                'lon': lon,
                'type': inc_type,
                'desc': inc.get('description', ''),
                'started': inc.get('start_dt_utc', ''),
                'modified': inc.get('modified_dt_utc', ''),
            })
        except Exception:
            continue
    
    # Compute per-edge level
    edges_dict = {}
    
    for road in roads:
        eid = road['id']
        lanes = road.get('lanes', 1)
        speed_ms = road.get('speed', 13.9)
        shape = road.get('shape', [])
        
        # Road class: major if high speed or many lanes, else local
        road_class = 1.0 if (speed_ms >= 16 or lanes >= 2) else 0.5
        
        # Base level from typical-by-hour model
        level = _typical_by_hour(hour, not is_weekday, road_class)
        
        # Incident boost: check distance to all incidents
        for inc in incident_points:
            dist = _nearest_distance_to_edge_shape(inc['x'], inc['y'], shape)
            
            if dist < 250:  # Within 250m
                # Linear decay: at 0m = full boost, at 250m = 0
                proximity = 1.0 - (dist / 250.0)
                
                # Boost amount depends on incident type
                is_severe = _is_severe_incident(inc['type'])
                boost = 0.7 if is_severe else 0.5
                
                incident_contribution = proximity * boost
                level = min(1.0, level + incident_contribution)
        
        # Only report if level >= 0.05
        if level >= 0.05:
            edges_dict[eid] = round(level, 2)
    
    return {
        'updated': now_utc.isoformat(),
        'stale': stale,
        'hour': hour,
        'isWeekday': is_weekday,
        'mode': 'typical-by-hour estimate + live incidents',
        'incidents': incident_points,
        'edges': edges_dict,
        'disclaimer': (
            'Per-street congestion levels are estimates based on a simple '
            'hourly model + live incident locations from the City of Calgary. '
            'These are NOT real-time speed measurements. '
            'Live data comes from public traffic incidents (refreshed ~10 min); '
            'actual speeds vary. See /sources.json for data attribution.'
        )
    }


def get_sources(net_offset_info):
    """Return list of all data sources.
    
    Args:
        net_offset_info: tuple (net_offset, bounds, roads_count, buildings_count)
    
    Returns: dict {
        'generated': ISO8601,
        'sources': [ {name, provides, url, licence, attribution, status, updated, note} ]
    }
    """
    refresh_cache()
    
    with _cache_lock:
        incidents = _cache['incidents']
        fetch_time = _cache['fetched_at']
    
    now_utc = datetime.now(timezone.utc).isoformat()
    last_fetch = datetime.fromtimestamp(fetch_time, tz=timezone.utc).isoformat() if fetch_time else 'never'
    
    sources = [
        {
            'name': 'City of Calgary Current Traffic Incidents',
            'provides': 'Live incident locations, types, descriptions',
            'url': 'https://data.calgary.ca/resource/4jah-h97u.json',
            'licence': 'Open Government Licence - City of Calgary',
            'attribution': 'The City of Calgary',
            'status': 'live',
            'updated': last_fetch,
            'note': f'~10 min refresh; last fetch {len(incidents)} incidents; ID 4jah-h97u'
        },
        {
            'name': 'City of Calgary Archived Traffic Incidents',
            'provides': 'Historical incident data',
            'url': 'https://data.calgary.ca/resource/35ra-9556.json',
            'licence': 'Open Government Licence - City of Calgary',
            'attribution': 'The City of Calgary',
            'status': 'static',
            'updated': 'varies',
            'note': 'Archive ID 35ra-9556; not used by this system'
        },
        {
            'name': 'OpenStreetMap (Overpass API)',
            'provides': 'Road network, street names, building footprints, parks, water',
            'url': 'https://overpass-api.de/api/interpreter',
            'licence': 'Open Data Commons Open Database License (ODbL)',
            'attribution': '© OpenStreetMap contributors',
            'status': 'static',
            'updated': '2026-10-01',
            'note': 'Snapshot queried via Overpass during export_scene.py'
        },
        {
            'name': 'Building heights (OSM + pseudo-random)',
            'provides': 'Building height estimates for 3D rendering',
            'url': 'https://www.openstreetmap.org/',
            'licence': 'ODbL (OSM), original (pseudo-random fallback)',
            'attribution': '© OpenStreetMap contributors (where tags present)',
            'status': 'modelled',
            'updated': '2026-10-01',
            'note': 'OSM height/levels tags where present; pseudo-random 10-45m otherwise'
        },
        {
            'name': 'SUMO microscopic traffic simulator',
            'provides': 'Vehicle movement, signal timing (defaults)',
            'url': 'https://sumo.dlr.de/',
            'licence': 'Eclipse Public Licence 2.0 (EPL-2.0)',
            'attribution': 'Eclipse SUMO Project',
            'status': 'placeholder',
            'updated': 'v1.27.1',
            'note': 'Vehicle demand from SUMO randomTrips (NOT real counts); signal timings from netconvert actuated defaults (NOT Calgary real plans)'
        },
        {
            'name': 'Typical-by-hour congestion model',
            'provides': 'Baseline congestion estimates by time of day',
            'url': 'local',
            'licence': 'Project-internal assumption',
            'attribution': 'This project',
            'status': 'modelled',
            'updated': now_utc,
            'note': 'Simple heuristic: weekday peaks 07-09, 16-18; higher for major roads; weekend flatter. NOT measured data.'
        },
        {
            'name': 'three.js graphics library',
            'provides': '3D rendering on web client',
            'url': 'https://threejs.org/',
            'licence': 'MIT',
            'attribution': 'three.js contributors',
            'status': 'static',
            'updated': 'r150+',
            'note': 'Client-side 3D rendering'
        },
        {
            'name': 'Calgary Traffic Cameras',
            'provides': 'Live traffic camera feeds (NOT used)',
            'url': 'https://data.calgary.ca/resource/k7p9-kppz.json',
            'licence': 'Open Government Licence - City of Calgary',
            'attribution': 'The City of Calgary',
            'status': 'available-not-used',
            'updated': 'varies',
            'note': 'Dataset k7p9-kppz; live feeds available but not integrated into congestion model'
        },
        {
            'name': 'Alberta 511 Traffic Information',
            'provides': 'Real-time traffic, weather, incident alerts (NOT used)',
            'url': 'https://www.511.ab.ca/',
            'licence': 'Government of Alberta',
            'attribution': 'Government of Alberta',
            'status': 'available-not-used',
            'updated': 'live',
            'note': 'Real-time feed available with API key; not used due to API key requirement'
        },
    ]
    
    return {
        'generated': now_utc,
        'sources': sources
    }
