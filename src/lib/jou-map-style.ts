import type { Map, LayerSpecification } from 'maplibre-gl'

/** A geographic illustration style: original tile geometry, Chinese labels and attribution stay intact. */
export function applyJouIllustration(map: Map): () => void {
  const layers = map.getStyle().layers
  const restore: Array<() => void> = []
  const added: string[] = []
  type PaintKey = Parameters<Map['setPaintProperty']>[1]
  function paint(layer: LayerSpecification, property: PaintKey, value: unknown) {
    const previous = (layer.paint as Record<string, unknown> | undefined)?.[property]
    map.setPaintProperty(layer.id, property, value as never)
    restore.push(() => { if (map.getLayer(layer.id)) map.setPaintProperty(layer.id, property, (previous ?? null) as never) })
  }
  const labelLayer = layers.find(layer => layer.type === 'symbol')?.id
  for (const layer of layers) {
    if (layer.id.startsWith('jou-')) continue
    const name = `${layer.id} ${'source-layer' in layer ? layer['source-layer'] : ''}`.toLowerCase()
    if (layer.type === 'background') paint(layer, 'background-color', '#faf1da')
    if (layer.type === 'fill') {
      if (/building/.test(name)) {
        paint(layer, 'fill-color', '#e7c89e'); paint(layer, 'fill-outline-color', '#8f775c'); paint(layer, 'fill-opacity', 1)
        const id = `jou-sketch-${layer.id}`
        if (!map.getLayer(id)) {
          map.addLayer({ id, type: 'line', source: layer.source, ...('source-layer' in layer ? { 'source-layer': layer['source-layer'] } : {}),
            minzoom: Math.max(14, layer.minzoom || 0), ...(layer.filter ? { filter: layer.filter } : {}),
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#8f775c', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, .7, 17, 1.5, 20, 2], 'line-opacity': .8, 'line-dasharray': [5, .35, 2, .25] },
          }, labelLayer)
          added.push(id)
        }
      } else if (/water/.test(name)) {
        paint(layer, 'fill-color', '#b6dadd'); paint(layer, 'fill-outline-color', '#80afb0')
      } else if (/wood|forest/.test(name)) paint(layer, 'fill-color', '#b1cd96')
      else if (/grass|park|garden|recreation/.test(name)) paint(layer, 'fill-color', '#d2e4ad')
      else if (/landcover|landuse/.test(name)) {
        paint(layer, 'fill-color', ['match', ['get', 'class'], 'wood', '#b1cd96', 'grass', '#d2e4ad', 'school', '#f1e3c7', 'college', '#f1e3c7', 'university', '#f1e3c7', '#e7e8c9'])
      }
    }
    if (layer.type === 'line') {
      if (/water/.test(name)) paint(layer, 'line-color', '#8abac0')
      else if (/transport|road|path|street/.test(name)) {
        paint(layer, 'line-color', /casing|outline/.test(name) ? '#d6bd96' : /path|track|foot/.test(name) ? '#c1a46f' : '#fffdf2')
        if (/path|foot/.test(name)) paint(layer, 'line-dasharray', [2, 1.4])
      }
    }
    if (layer.type === 'symbol' && layer.layout?.['text-field']) {
      paint(layer, 'text-color', /water/.test(name) ? '#4b828a' : '#395941')
      paint(layer, 'text-halo-color', '#fff9e9'); paint(layer, 'text-halo-width', 1.5)
    }
    if (layer.type === 'fill-extrusion' && /building/.test(name)) paint(layer, 'fill-extrusion-color', '#e7c89e')
  }
  return () => {
    for (const id of added) if (map.getLayer(id)) map.removeLayer(id)
    for (const undo of restore.reverse()) undo()
  }
}
