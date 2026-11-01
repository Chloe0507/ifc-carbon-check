"""Turns the Ökobaudat CSV export into the compact JSON the app loads.

Usage: python3 scripts/oekobaudat.py OBD_2024_II.csv public/data/oekobaudat-2024-II.json

The export has one row per dataset and life-cycle module. We keep the GWP of
modules A1-A3, C3, C4 and D, the declared unit and the conversion factors,
and the EN 15804 version (+A1 datasets report "GWP", +A2 datasets "GWPtotal").
Download the export from https://www.oekobaudat.de/en/service/downloads.html
(CSV, period as decimal separator).
"""
import csv
import json
import re
import sys
from collections import Counter

src, out = sys.argv[1], sys.argv[2]

raw = open(src, "rb").read()
for enc in ("utf-8-sig", "cp1252", "latin-1"):
    try:
        text = raw.decode(enc)
        break
    except UnicodeDecodeError:
        continue
dialect = csv.Sniffer().sniff(text[:5000], delimiters=";,\t")
rows = list(csv.DictReader(text.splitlines(), dialect=dialect))
cols = list(rows[0].keys())


def col(*patterns, required=True):
    """The first column whose name matches one of the patterns (case-insensitive)."""
    for p in patterns:
        for c in cols:
            if re.fullmatch(p, c.strip(), re.I):
                return c
    if required:
        sys.exit(f"No column matching {patterns}. Columns: {cols}")
    return None


C = {
    "uuid": col(r"UUID"),
    "name_de": col(r"Name \(de\)"),
    "name_en": col(r"Name \(en\)", required=False),
    "cat": col(r"Kategorie \(en\)", r"Kategorie \(original\)", r"Kategorie.*"),
    "type": col(r"Typ", r"Type"),
    "conf": col(r"Konformit.{1,4}t", r"Conformity", required=False),
    "valid": col(r"G.{1,4}ltig bis", r"Valid until", required=False),
    "ref": col(r"Bezugsgr.{1,4}e", r"Reference ?size"),
    "unit": col(r"Bezugseinheit", r"Reference unit"),
    "rohdichte": col(r"Rohdichte.*", r"Gross density.*", required=False),
    "schuett": col(r"Sch.{1,4}ttdichte.*", r"Bulk density.*", required=False),
    "area": col(r"Fl.{1,4}chengewicht.*", r"Grammage.*", required=False),
    "module": col(r"Modul", r"Module"),
    "scenario": col(r"Szenario", r"Scenario", required=False),
    "gwp_a1": col(r"GWP", required=False),
    "gwp_a2": col(r"GWPtotal.*", r"GWP-total.*", required=False),
}


def num(v):
    v = (v or "").strip().replace(",", ".") if v else ""
    try:
        return float(v)
    except ValueError:
        return None


UNIT = {"qm": "m2", "m²": "m2", "m³": "m3", "pcs.": "pcs", "Stück": "pcs"}
MODULE = {"A1-A3": "A1-A3", "A1-3": "A1-A3", "C3": "C3", "C4": "C4", "D": "D"}

datasets = {}
modules_seen = Counter()
for r in rows:
    uuid = r[C["uuid"]].strip()
    mod_raw = r[C["module"]].strip()
    modules_seen[mod_raw] += 1
    a2 = num(r[C["gwp_a2"]]) if C["gwp_a2"] else None
    a1 = num(r[C["gwp_a1"]]) if C["gwp_a1"] else None
    d = datasets.setdefault(
        uuid,
        {
            "uuid": uuid,
            "name": (r[C["name_en"]] if C["name_en"] else "").strip() or r[C["name_de"]].strip(),
            "nameDe": r[C["name_de"]].strip(),
            "category": r[C["cat"]].strip(),
            "type": r[C["type"]].strip().replace(" dataset", ""),
            "conformity": (r[C["conf"]] if C["conf"] else "").strip(),
            "unit": UNIT.get(r[C["unit"]].strip(), r[C["unit"]].strip()),
            "refAmount": num(r[C["ref"]]) or 1,
            "density": num(r[C["rohdichte"]]) if C["rohdichte"] else None,
            "bulkDensity": num(r[C["schuett"]]) if C["schuett"] else None,
            "areaWeight": num(r[C["area"]]) if C["area"] else None,
            "validUntil": (r[C["valid"]] if C["valid"] else "").strip(),
            "gwp": {},
            "parts": {},
            "a2": False,
        },
    )
    if a2 is not None:
        d["a2"] = True
    value = a2 if a2 is not None else a1
    if value is None:
        continue
    # Several scenarios for one module (e.g. C3 recycling vs. incineration):
    # keep the first and note it, since the app shows one value per module.
    scen = (r[C["scenario"]] if C["scenario"] else "").strip()
    if mod_raw in MODULE:
        key = MODULE[mod_raw]
        if key not in d["gwp"]:
            d["gwp"][key] = value
            if scen:
                d.setdefault("scenarios", {})[key] = scen
    elif mod_raw in ("A1", "A2", "A3"):
        d["parts"][mod_raw] = value

result = []
for d in datasets.values():
    # Some datasets declare A1, A2 and A3 separately: sum them.
    if "A1-A3" not in d["gwp"] and {"A1", "A2", "A3"} <= d["parts"].keys():
        d["gwp"]["A1-A3"] = sum(d["parts"].values())
    if "A1-A3" not in d["gwp"]:
        continue  # nothing to calculate with
    d["standard"] = "EN 15804+A2" if d.pop("a2") else "EN 15804+A1"
    del d["parts"]
    if not d["density"]:
        d["density"] = d["bulkDensity"]
    del d["bulkDensity"]
    # Store GWP per 1 declared unit (some datasets are declared per 1000 kg).
    ref = d.pop("refAmount") or 1
    d["gwp"] = {k: float(f"{v / ref:.4g}") for k, v in d["gwp"].items()}
    result.append(d)

result.sort(key=lambda d: (d["category"], d["name"]))
json.dump(
    {"source": "ÖKOBAUDAT (BBSR), https://www.oekobaudat.de", "version": "2024-II", "datasets": result},
    open(out, "w"),
    ensure_ascii=False,
    separators=(",", ":"),
)
std = Counter(d["standard"] for d in result)
print(f"{len(rows)} rows, {len(datasets)} datasets, {len(result)} with A1-A3 -> {out}")
print("standards:", dict(std))
print("modules in file:", dict(modules_seen.most_common(25)))
print("units:", dict(Counter(d["unit"] for d in result)))
print("types:", dict(Counter(d["type"] for d in result)))
