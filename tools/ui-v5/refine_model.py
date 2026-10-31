import bpy, math, json
from mathutils import Vector
OUT=r'C:/Users/upwar/Desktop/新建文件夹 (6)/design-system/ui-v5'

# Round the eye outlines; preserve the independent parts for the next rigging step.
for suffix in ['L','R']:
 old=bpy.data.objects['Eye.'+suffix];loc=old.location.copy();mat=old.data.materials[0]
 bpy.data.objects.remove(old,do_unlink=True)
 bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=8,location=loc)
 eye=bpy.context.object;eye.name='Eye.'+suffix;eye.scale=(.099,.058,.136)
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 eye.data.materials.append(mat)
 for p in eye.data.polygons:p.use_smooth=True

# A continuous bushy tail with a cream tip instead of two separate round balls.
for name in ['Tail','TailTip']:bpy.data.objects.remove(bpy.data.objects[name],do_unlink=True)
rings=[((.13,.20,.46),.075),((.31,.31,.53),.21),((.47,.35,.70),.225),((.53,.36,.91),.17),((.56,.34,1.09),.025)]
verts=[];faces=[]
for (cx,cy,cz),radius in rings:
 for j in range(8):
  a=2*math.pi*j/8;verts.append((cx+math.cos(a)*radius,cy+math.sin(a)*radius*.85,cz))
faces.append(tuple(reversed(range(8))))
for i in range(len(rings)-1):
 for j in range(8):faces.append((i*8+j,i*8+(j+1)%8,(i+1)*8+(j+1)%8,(i+1)*8+j))
faces.append(tuple(range(32,40)))
mesh=bpy.data.meshes.new('BushyTail_Mesh');mesh.from_pydata(verts,[],faces);mesh.update()
tail=bpy.data.objects.new('Tail',mesh);bpy.context.collection.objects.link(tail)
for name in ['Fur_Orange_ff9a3d','Cream_fff0dc']:mesh.materials.append(bpy.data.materials[name])
for poly in mesh.polygons:
 poly.use_smooth=True;poly.material_index=1 if poly.index>=25 else 0
mod=tail.modifiers.new('Rounded_Subdivision_1','SUBSURF');mod.levels=1;mod.render_levels=1

# Keep one subdivision level, then reduce interior triangles while retaining the outline.
for o in bpy.context.scene.objects:
 if o.type=='MESH' and any(m.type=='SUBSURF' for m in o.modifiers):
  mod=o.modifiers.new('Mobile_LowPoly','DECIMATE');mod.ratio=.90 if o.name=='Head' else .62

scene=bpy.context.scene
bpy.ops.object.camera_add(location=(3.2,-7,3));camera=bpy.context.object;camera.name='PreviewCamera';camera.data.type='ORTHO';camera.data.ortho_scale=3.25;scene.camera=camera
fixtures=[camera]
for loc,power,size in [((-3,-4,6),380,5),((4,-2,4),230,4),((0,4,5),400,4)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,1.25))-o.location).to_track_quat('-Z','Y').to_euler();fixtures.append(o)
for name,loc in [('model-front',(0,-7,2.45)),('model-three-quarter',(3.2,-7,3.0)),('model-back',(3.2,7,2.8))]:
 camera.location=loc;camera.rotation_euler=(Vector((0,0,1.32))-camera.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=OUT+'/'+name+'.png';bpy.ops.render.render(write_still=True)
for o in fixtures:bpy.data.objects.remove(o,do_unlink=True)
scene.camera=None
for o in scene.objects:o.select_set(False)
bpy.data.objects['Head'].select_set(True);bpy.context.view_layer.objects.active=bpy.data.objects['Head']
dg=bpy.context.evaluated_depsgraph_get();objects=[]
for o in scene.objects:
 e=o.evaluated_get(dg);m=e.to_mesh();m.calc_loop_triangles();objects.append({'name':o.name,'type':o.type,'triangles':len(m.loop_triangles)});e.to_mesh_clear()
report={'stage':'model-and-materials','blender':bpy.app.version_string,'objects':objects,'objectCount':len(objects),'trianglesBefore':6232,'trianglesAfter':sum(o['triangles'] for o in objects),'materials':[{'name':m.name,'roughness':m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value,'subsurface':m.node_tree.nodes['Principled BSDF'].inputs['Subsurface Weight'].default_value,'alpha':m.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value} for m in bpy.data.materials if m.use_nodes and m.node_tree.nodes.get('Principled BSDF')],'rigged':False,'animations':[],'glbExported':False}
assert report['trianglesAfter']<5000,report
open(OUT+'/model-report.json','w',encoding='utf-8').write(json.dumps(report,ensure_ascii=False,indent=2))
bpy.ops.wm.save_as_mainfile(filepath=OUT+'/fox-v5-model.blend')
print(json.dumps(report,ensure_ascii=False))
