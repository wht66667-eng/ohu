import bpy, json
dg=bpy.context.evaluated_depsgraph_get()
report=[]
for o in bpy.context.scene.objects:
 if o.type in ['MESH','CURVE']:
  e=o.evaluated_get(dg);m=e.to_mesh();m.calc_loop_triangles()
  report.append({'name':o.name,'triangles':len(m.loop_triangles)})
  e.to_mesh_clear()
print(json.dumps(report));print('TOTAL:',sum(o['triangles'] for o in report))
