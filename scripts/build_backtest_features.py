"""Reproduce parcel screening inputs from downloaded source snapshots.

Requires pyshp, shapely and pyproj. Raw files stay outside this repository.
"""

import argparse
import csv
import io
import json
import random
import re
import zipfile
from collections import defaultdict
from pathlib import Path

import shapefile
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform
from shapely.strtree import STRtree


def reader_from_zip(path):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        parts = [io.BytesIO(archive.read(next(name for name in names if name.lower().endswith(ext))))
                 for ext in ('.shp', '.shx', '.dbf')]
    return shapefile.Reader(shp=parts[0], shx=parts[1], dbf=parts[2])


def clean(geometry):
    if geometry.is_empty:
        return geometry
    return geometry if geometry.is_valid else geometry.buffer(0)


def permit_cases(path):
    cases = defaultdict(list)
    pattern = re.compile(r'\b(?:TWO[ -]FAMILY|TWO[ -]UNIT|2[ -]UNIT|DUPLEX)\b')
    with path.open(newline='', encoding='utf-8-sig') as source:
        for row in csv.DictReader(source):
            if row['permit_type'] not in {'BUILDING', 'Building & Development Application'}:
                continue
            if row['work_type'].upper() != 'NEW CONSTRUCTION':
                continue
            if row['commercial_or_residential'] != 'Residential':
                continue
            if row['status'] not in {'Issued', 'Completed'} or not row['issue_date']:
                continue
            description = row['work_description'].upper()
            if not pattern.search(description) or 'CLUSTER' in description:
                continue
            pin = row['parcel_num'].strip()
            if re.fullmatch(r'[0-9A-Z]{16}', pin):
                cases[pin].append({'permit_id': row['permit_id'], 'issue_date': row['issue_date']})
    return cases


def geojson_index(path, project, include=lambda properties: True):
    features = json.loads(path.read_text())['features']
    geometries = []
    properties = []
    for feature in features:
        if feature['geometry'] is None or not include(feature['properties']):
            continue
        geometry = clean(transform(project, shape(feature['geometry'])))
        if not geometry.is_empty:
            geometries.append(geometry)
            properties.append(feature['properties'])
    return STRtree(geometries), properties


def slope_index(path):
    source = reader_from_zip(path)
    geometries = []
    for entry in source.iterShapes():
        if entry.shapeType not in {5, 15, 25, 31}:
            continue
        geometry = clean(shape(entry.__geo_interface__))
        if not geometry.is_empty:
            geometries.append(geometry)
    return STRtree(geometries), None


def overlays(parcel, index, label=None):
    tree, properties = index
    total = 0.0
    labels = set()
    for number in tree.query(parcel):
        number = int(number)
        intersection = parcel.intersection(tree.geometries[number])
        if intersection.is_empty or intersection.area <= 0.01:
            continue
        total += intersection.area
        if label and properties[number].get(label):
            labels.add(str(properties[number][label]))
    return {'share': round(min(100, 100 * total / parcel.area), 4), 'labels': sorted(labels)}


def zoning(parcel, index):
    tree, properties = index
    groups = defaultdict(float)
    for number in tree.query(parcel):
        number = int(number)
        overlap = parcel.intersection(tree.geometries[number]).area
        if overlap > 0.01:
            row = properties[number]
            groups[(row.get('zon_new') or 'Uncoded', row.get('status'))] += overlap
    return [{'code': key[0], 'status': key[1], 'parcelShare': round(100 * value / parcel.area, 4)}
            for key, value in sorted(groups.items(), key=lambda entry: -entry[1])]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--sample-size', type=int, default=2000)
    args = parser.parse_args()
    base = args.data_dir
    cases = permit_cases(base / 'review/pli_permits.csv')
    parcels = reader_from_zip(base / 'score/parcel_boundaries_202609.zip')

    # County shapefile and city slope shapefile use NAD83 State Plane PA South, US feet.
    project = Transformer.from_crs('EPSG:4326', 'EPSG:2272', always_xy=True).transform
    indices = {
        'zoning': geojson_index(base / 'score/zoning.geojson', project),
        'flood': geojson_index(base / 'score/fema_2026_city.geojson', project,
                               lambda p: p.get('SFHA_TF') == 'T'),
        'slope': slope_index(base / 'score/steep_slopes_25pct.zip'),
        'undermined': geojson_index(base / 'score/undermined_areas.geojson', project),
    }
    print('Overlays indexed', flush=True)

    randomizer = random.Random(20260927)
    sample = []
    positive_indices = {}
    city_count = 0
    for number, record in enumerate(parcels.iterRecords()):
        pin = str(record[0]).strip()
        if pin in cases:
            positive_indices[pin] = number
        if not 101 <= int(record[2] or 0) <= 132:
            continue
        city_count += 1
        if len(sample) < args.sample_size:
            sample.append(number)
        else:
            replace = randomizer.randrange(city_count)
            if replace < args.sample_size:
                sample[replace] = number
    print('City parcels:', city_count, 'permit IDs:', len(cases),
          'parcel matches:', len(positive_indices), flush=True)

    selected = sorted(set(sample) | set(positive_indices.values()))
    positive_numbers = set(positive_indices.values())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('w') as output:
        for position, number in enumerate(selected, 1):
            record = parcels.record(number)
            parcel = clean(shape(parcels.shape(number).__geo_interface__))
            if parcel.is_empty or parcel.area <= 0 or parcel.length <= 0:
                continue
            pin = str(record[0]).strip()
            result = {
                'pin': pin,
                'cohort': 'issued_two_unit_permit' if number in positive_numbers else 'city_random_sample',
                'permits': cases.get(pin, []),
                'areaSqM': parcel.area / 10.7639104167,
                'compactness': min(1, 4 * 3.141592653589793 * parcel.area / parcel.length ** 2),
                'districts': zoning(parcel, indices['zoning']),
                'flood': overlays(parcel, indices['flood'], 'FLD_ZONE'),
                'slope': overlays(parcel, indices['slope']),
                'undermined': overlays(parcel, indices['undermined']),
            }
            output.write(json.dumps(result, separators=(',', ':')) + '\n')
            if position % 250 == 0:
                print('Processed:', position, '/', len(selected), flush=True)
    print('Wrote', args.output, flush=True)


if __name__ == '__main__':
    main()
