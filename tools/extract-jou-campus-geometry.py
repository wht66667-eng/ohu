"""Convert a small, saved OSM map API response to campus-scoped GeoJSON.

No geocoding, image interpretation, invented coordinates, or online writes.
Coordinates and tags are retained from the source response. Crossing features
keep their complete original way geometry; this is not polygon clipping.
"""
import argparse
import json
from collections import Counter
from pathlib import Path
import xml.etree.ElementTree as ET


def inside(point, polygon):
    x, y = point
    result = False
    j = len(polygon) - 1
    for i in range(len(polygon)):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            result = not result
        j = i
    return result


def tags(element):
    return {tag.attrib['k']: tag.attrib['v'] for tag in element.findall('tag')}


def category(values, boundary=False):
    if boundary:
        return 'campus'
    if values.get('building') and values['building'] != 'no':
        return 'building'
    if values.get('leisure') in ('pitch', 'track', 'sports_centre', 'stadium', 'swimming_pool') or values.get('sport'):
        return 'sport'
    if values.get('natural') == 'water' or values.get('waterway') == 'riverbank' or values.get('landuse') in ('reservoir', 'basin') or values.get('water'):
        return 'water'
    if values.get('natural') in ('wood', 'tree_row', 'scrub', 'grassland') or values.get('landuse') in ('forest', 'grass', 'meadow', 'recreation_ground') or values.get('leisure') in ('park', 'garden'):
        return 'green'
    if values.get('highway'):
        return 'road'
    if any(key in values for key in ('name', 'amenity', 'shop', 'tourism', 'leisure', 'entrance')):
        return 'poi'
    return None


def convert(source, output, boundary_id, name, retrieved_at):
    tree = ET.parse(source).getroot()
    nodes = {int(node.attrib['id']): node for node in tree.findall('node')}
    positions = {key: [float(node.attrib['lon']), float(node.attrib['lat'])] for key, node in nodes.items()}
    ways = {int(way.attrib['id']): way for way in tree.findall('way')}
    boundary = ways[boundary_id]
    boundary_points = [positions[int(nd.attrib['ref'])] for nd in boundary.findall('nd')]
    if boundary_points[0] != boundary_points[-1]:
        raise ValueError('Campus boundary must be closed')
    features = []
    skipped = Counter()

    def add(kind, osm_type, osm_id, values, geometry, relation):
        properties = {'kind': kind, 'name': values.get('name:zh') or values.get('name', ''), 'osm_type': osm_type,
                      'osm_id': osm_id, 'campus_relation': relation, 'tags': values}
        for key in ('building', 'highway', 'leisure', 'landuse', 'natural', 'amenity', 'sport', 'entrance'):
            if key in values:
                properties[key] = values[key]
        features.append({'type': 'Feature', 'id': f'osm-{osm_type}-{osm_id}', 'properties': properties, 'geometry': geometry})

    for node_id, node in nodes.items():
        values = tags(node)
        if not values or not inside(positions[node_id], boundary_points):
            continue
        # Geometry vertices and traffic signals are not independently useful POIs.
        if not any(key in values for key in ('name', 'amenity', 'shop', 'tourism', 'entrance')):
            continue
        add('poi', 'node', node_id, values, {'type': 'Point', 'coordinates': positions[node_id]}, 'inside')

    for way_id, way in ways.items():
        values = tags(way)
        kind = category(values, way_id == boundary_id)
        if not kind:
            continue
        refs = [int(nd.attrib['ref']) for nd in way.findall('nd')]
        if any(ref not in positions for ref in refs):
            skipped['incomplete_ways'] += 1
            continue
        coords = [positions[ref] for ref in refs]
        if len(coords) < 2:
            continue
        flags = [inside(point, boundary_points) for point in coords]
        if way_id != boundary_id and not any(flags):
            skipped['outside_ways'] += 1
            continue
        # A neighbouring named site touching the campus is not a campus POI.
        if kind == 'poi' and not all(flags):
            skipped['crossing_named_sites'] += 1
            continue
        polygon = len(coords) >= 4 and coords[0] == coords[-1] and (kind != 'road' or values.get('area') == 'yes')
        geometry = {'type': 'Polygon', 'coordinates': [coords]} if polygon else {'type': 'LineString', 'coordinates': coords}
        relation = 'boundary' if way_id == boundary_id else 'inside' if all(flags) else 'crosses'
        add(kind, 'way', way_id, values, geometry, relation)

    xs = [point[0] for point in boundary_points]
    ys = [point[1] for point in boundary_points]
    counts = dict(Counter(feature['properties']['kind'] for feature in features))
    bounds = tree.find('bounds')
    result = {'type': 'FeatureCollection', 'name': name, 'bbox': [min(xs), min(ys), max(xs), max(ys)],
              'metadata': {'source': 'OpenStreetMap contributors via OSM map API', 'retrieved_at': retrieved_at,
                           'license': 'ODbL-1.0', 'attribution': '© OpenStreetMap contributors',
                           'source_url': f'https://www.openstreetmap.org/way/{boundary_id}',
                           'coordinate_system': 'WGS84 / GeoJSON longitude, latitude',
                           'campus_boundary_osm_way': boundary_id, 'feature_counts': counts,
                           'source_query_bbox': bounds.attrib if bounds is not None else None,
                           'skipped': dict(skipped),
                           'status': 'public_map_geometry_not_official_campus_poi_verification',
                           'note': 'Only public OSM vertices and tags are preserved. Campus scope uses a vertex-in-boundary filter; crossing ways retain original geometry. Names, footprints, entrances and access rules may be incomplete or outdated. No image-derived or invented coordinates.'},
              'features': features}
    Path(output).write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'output': str(output), 'bbox': result['bbox'], 'features': len(features), 'counts': counts, 'skipped': dict(skipped)}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('output')
    parser.add_argument('--boundary', type=int, required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--date', default='2026-10-26')
    args = parser.parse_args()
    convert(args.source, args.output, args.boundary, args.name, args.date)
