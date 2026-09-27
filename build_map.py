# -*- coding: utf-8 -*-
"""把 DataV 省级边界收成可点击的地级行政区地图。"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

sys.setrecursionlimit(20000)

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
NATIONAL = ROOT / "_raw_china.json"
OUT = ROOT / "data" / "map.js"

MUNICIPALITIES = {"110000", "120000", "310000", "500000"}
SINGLE = MUNICIPALITIES | {"710000", "810000", "820000"}

PROVINCE_ORDER = [
    "110000", "120000", "130000", "140000", "150000",
    "210000", "220000", "230000",
    "310000", "320000", "330000", "340000", "350000", "360000", "370000",
    "410000", "420000", "430000", "440000", "450000", "460000",
    "500000", "510000", "520000", "530000", "540000",
    "610000", "620000", "630000", "640000", "650000",
    "710000", "810000", "820000",
]

PHI1 = math.radians(25)
PHI2 = math.radians(47)
PHI0 = math.radians(36)
LAM0 = math.radians(104)
N = (math.sin(PHI1) + math.sin(PHI2)) / 2
C = math.cos(PHI1) ** 2 + 2 * N * math.sin(PHI1)
RHO0 = math.sqrt(C - 2 * N * math.sin(PHI0)) / N


def project(lon: float, lat: float) -> tuple[float, float]:
    phi = math.radians(lat)
    lam = math.radians(lon)
    rho = math.sqrt(max(C - 2 * N * math.sin(phi), 1e-12)) / N
    theta = N * (lam - LAM0)
    x = rho * math.sin(theta)
    y = RHO0 - rho * math.cos(theta)
    return x, y


def short_province(name: str) -> str:
    for suffix in ("维吾尔自治区", "壮族自治区", "回族自治区", "特别行政区", "自治区", "省", "市"):
        if name.endswith(suffix) and len(name) > len(suffix):
            return name[: -len(suffix)]
    return name


def kind_of(adcode: str) -> str:
    if adcode in MUNICIPALITIES:
        return "municipality"
    if adcode in {"810000", "820000"}:
        return "sar"
    if adcode == "710000":
        return "taiwan"
    if not str(adcode).endswith("00"):
        return "direct"
    return "prefecture"


def iter_rings(geometry: dict):
    gtype = geometry["type"]
    coords = geometry["coordinates"]
    if gtype == "Polygon":
        for ring in coords:
            yield ring
    elif gtype == "MultiPolygon":
        for poly in coords:
            for ring in poly:
                yield ring


def point_line_distance(point, start, end) -> float:
    px, py = point
    ax, ay = start
    bx, by = end
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def rdp(points, epsilon: float):
    if len(points) < 3:
        return points
    dmax = 0.0
    index = 0
    for i in range(1, len(points) - 1):
        d = point_line_distance(points[i], points[0], points[-1])
        if d > dmax:
            dmax = d
            index = i
    if dmax > epsilon:
        left = rdp(points[: index + 1], epsilon)
        right = rdp(points[index:], epsilon)
        return left[:-1] + right
    return [points[0], points[-1]]


def simplify_ring(ring, epsilon=0.012):
    pts = [(float(p[0]), float(p[1])) for p in ring]
    cleaned = [pts[0]]
    for pt in pts[1:]:
        if math.hypot(pt[0] - cleaned[-1][0], pt[1] - cleaned[-1][1]) > 1e-7:
            cleaned.append(pt)
    if len(cleaned) > 40:
        cleaned = rdp(cleaned, epsilon)
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1]:
        cleaned = cleaned[:-1]
    if len(cleaned) < 3:
        return []
    return cleaned


def collect_cities():
    national = json.loads(NATIONAL.read_text(encoding="utf-8"))
    provinces = {}
    nine = None
    for feature in national["features"]:
        prop = feature["properties"]
        code = str(prop.get("adcode") or "")
        if code == "100000_JD":
            nine = feature["geometry"]
            continue
        if not code.endswith("0000"):
            continue
        provinces[code] = {
            "name": short_province(prop.get("name") or code),
            "full": prop.get("name") or code,
            "geometry": feature["geometry"],
        }

    cities = []
    for code in PROVINCE_ORDER:
        prov = provinces[code]
        if code in SINGLE:
            cities.append({
                "adcode": code,
                "name": prov["full"] if code not in {"810000", "820000"} else prov["name"],
                "province": prov["name"],
                "provinceAdcode": code,
                "kind": kind_of(code),
                "space": "inset" if False else "main",
                "rings": [simplify_ring(r) for r in iter_rings(prov["geometry"])],
            })
            cities[-1]["name"] = {
                "110000": "北京市",
                "120000": "天津市",
                "310000": "上海市",
                "500000": "重庆市",
                "710000": "台湾省",
                "810000": "香港",
                "820000": "澳门",
            }.get(code, prov["full"])
            continue
        data = json.loads((RAW / f"{code}_full.json").read_text(encoding="utf-8"))
        features = sorted(data["features"], key=lambda f: int(f["properties"]["adcode"]))
        for feature in features:
            prop = feature["properties"]
            adcode = str(prop["adcode"])
            space = "inset" if adcode == "460300" else "main"
            cities.append({
                "adcode": adcode,
                "name": prop.get("name") or adcode,
                "province": prov["name"],
                "provinceAdcode": code,
                "kind": kind_of(adcode),
                "space": space,
                "rings": [simplify_ring(r) for r in iter_rings(feature["geometry"])],
            })
    for city in cities:
        city["rings"] = [r for r in city["rings"] if r]
    return cities, nine, provinces


def make_transform(rings):
    pts = [project(lon, lat) for ring in rings for lon, lat in ring]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    minx, maxx = min(xs), max(xs)
    miny, maxy = min(ys), max(ys)
    pad = 28
    width = 1000
    scale = width / (maxx - minx)
    height = (maxy - miny) * scale

    def convert(lon, lat):
        x, y = project(lon, lat)
        sx = (x - minx) * scale + pad
        sy = (maxy - y) * scale + pad
        return sx, sy

    view = [0, 0, round(width + pad * 2, 1), round(height + pad * 2, 1)]
    return convert, view


def path_from(rings, convert) -> str:
    parts = []
    for ring in rings:
        if len(ring) < 3:
            continue
        cmds = []
        for i, (lon, lat) in enumerate(ring):
            x, y = convert(lon, lat)
            cmds.append(("M" if i == 0 else "L") + f"{x:.1f},{y:.1f}")
        cmds.append("Z")
        parts.append("".join(cmds))
    return "".join(parts)


def box_from(rings, convert):
    xs, ys = [], []
    for ring in rings:
        for lon, lat in ring:
            x, y = convert(lon, lat)
            xs.append(x)
            ys.append(y)
    return [round(min(xs), 1), round(min(ys), 1), round(max(xs) - min(xs), 1), round(max(ys) - min(ys), 1)]


def main():
    cities, nine, provinces = collect_cities()
    main_rings = [r for c in cities if c["space"] == "main" for r in c["rings"]]
    inset_rings = [r for c in cities if c["space"] == "inset" for r in c["rings"]]
    to_main, main_view = make_transform(main_rings)
    to_inset, inset_view = make_transform(inset_rings)

    out_cities = []
    for city in cities:
        convert = to_inset if city["space"] == "inset" else to_main
        out_cities.append({
            "adcode": city["adcode"],
            "name": city["name"],
            "province": city["province"],
            "provinceAdcode": city["provinceAdcode"],
            "kind": city["kind"],
            "space": city["space"],
            "path": path_from(city["rings"], convert),
            "box": box_from(city["rings"], convert),
        })

    grouped = []
    for code in PROVINCE_ORDER:
        members = [c["adcode"] for c in out_cities if c["provinceAdcode"] == code]
        if not members:
            continue
        grouped.append({
            "adcode": code,
            "name": provinces[code]["name"],
            "cities": members,
        })

    payload = {
        "viewBox": main_view,
        "insetViewBox": inset_view,
        "nineDash": path_from([simplify_ring(r, 0.03) for r in iter_rings(nine)], to_inset) if nine else "",
        "provinces": grouped,
        "cities": out_cities,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = "window.MAP = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
    OUT.write_text(text, encoding="utf-8")
    kinds = {}
    for city in out_cities:
        kinds[city["kind"]] = kinds.get(city["kind"], 0) + 1
    summary = {
        "cities": len(out_cities),
        "provinces": len(grouped),
        "kinds": kinds,
        "bytes": OUT.stat().st_size,
        "viewBox": main_view,
        "insetViewBox": inset_view,
    }
    (ROOT / "_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
