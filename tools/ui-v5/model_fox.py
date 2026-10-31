import bpy, math
from mathutils import Vector, Quaternion

OUT=r'C:/Users/upwar/Desktop/新建文件夹 (6)/design-system/ui-v5'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for data in list(bpy.data.materials):bpy.data.materials.remove(data)

def linear(v):return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4

def material(name,color,alpha=1):
 rgb=tuple(linear(int(color[i:i+2],16)/255) for i in (1,3,5))
 m=bpy.data.materials.new(name);m.diffuse_color=(*rgb,alpha);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*rgb,alpha);p.inputs['Roughness'].default_value=.8;p.inputs['Metallic'].default_value=0;p.inputs['Subsurface Weight'].default_value=.035;p.inputs['Alpha'].default_value=alpha;p.inputs['Specular IOR Level'].default_value=.25
 if alpha<1:m.surface_render_method='DITHERED'
 return m
orange=material('Fur_Orange_ff9a3d','#ff9a3d');deep=material('Fur_Shadow_ef7f24','#ef7f24');cream=material('Cream_fff0dc','#fff0dc');blush=material('Blush_ffb3a0_60percent','#ffb3a0',.6);eyes=material('Eyes_2a1a12','#2a1a12');green=material('Campus_Green_16735b','#16735b')

def finish(o,name,mat,subd=False):
 o.name=name;o.data.materials.append(mat)
 for p in o.data.polygons:p.use_smooth=True
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if subd:
  mod=o.modifiers.new('Rounded_Subdivision_1','SUBSURF');mod.levels=1;mod.render_levels=1
 return o

def orb(name,loc,scale,mat,segments=10,rings=5,subd=True):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=loc);o=bpy.context.object;o.scale=scale;return finish(o,name,mat,subd)

def ico(name,loc,scale,mat):
 bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=loc);o=bpy.context.object;o.scale=scale;return finish(o,name,mat,True)

def ear(name,center,mat,inset=False):
 x,y,z=center;s=-1 if x<0 else 1
 w=.16 if inset else .23;h=.34 if inset else .58;d=.018 if inset else .16
 verts=[(x-w,y-d,z),(x+w,y-d,z),(x+s*.07,y-d,z+h),(x-w,y+d,z),(x+w,y+d,z),(x+s*.07,y+d,z+h)]
 mesh=bpy.data.meshes.new(name+'_Mesh');mesh.from_pydata(verts,[],[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)]);mesh.update()
 o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);o.data.materials.append(mat)
 bevel=o.modifiers.new('Rounded_Edges','BEVEL');bevel.width=.035 if inset else .075;bevel.segments=2
 for p in mesh.polygons:p.use_smooth=True
 o.modifiers.new('Soft_Normals','WEIGHTED_NORMAL')
 return o

orb('Body',(0,0,.86),(.36,.28,.43),orange,12,6)
orb('Belly',(0,-.247,.85),(.225,.045,.28),cream,10,5)
orb('Head',(0,0,1.68),(.64,.46,.53),orange,12,8)
for sign,suffix in [(-1,'L'),(1,'R')]:
 ear('Ear.'+suffix,(sign*.41,.015,2.01),orange)
 ear('EarInner.'+suffix,(sign*.41,-.166,2.115),cream,True)
 arm=orb('Arm.'+suffix,(sign*.405,-.005,1.0),(.14,.15,.29),orange,8,4)
 arm.rotation_euler.y=sign*math.radians(-17)
 orb('Paw.'+suffix,(sign*.485,-.035,.748),(.147,.16,.15),orange,8,4)
 orb('Leg.'+suffix,(sign*.17,.02,.3),(.137,.16,.25),deep,8,4)
 orb('Foot.'+suffix,(sign*.17,-.08,.105),(.175,.24,.125),cream,8,4)
 orb('Cheek.'+suffix,(sign*.235,-.363,1.477),(.327,.115,.219),cream,10,5)
 orb('Eye.'+suffix,(sign*.215,-.416,1.762),(.099,.058,.136),eyes,12,6,False)
 orb('EyeLight.'+suffix,(sign*.215-.025,-.469,1.809),(.025,.014,.031),cream,8,4,False)
 orb('Blush.'+suffix,(sign*.366,-.47,1.545),(.073,.012,.04),blush,8,4,False)
orb('Muzzle',(0,-.414,1.438),(.295,.131,.146),cream,10,5)
orb('Nose',(0,-.54,1.562),(.073,.046,.045),eyes,10,5,False)
curve=bpy.data.curves.new('SmileCurve','CURVE');curve.dimensions='3D';curve.resolution_u=6;curve.bevel_depth=.012;curve.bevel_resolution=1
spline=curve.splines.new('BEZIER');spline.bezier_points.add(2)
for p,co in zip(spline.bezier_points,[(-.086,-.553,1.436),(0,-.558,1.393),(.086,-.553,1.436)]):p.co=co;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
mouth=bpy.data.objects.new('Smile',curve);bpy.context.collection.objects.link(mouth);curve.materials.append(eyes)
bpy.ops.mesh.primitive_torus_add(major_segments=16,minor_segments=6,location=(0,0,1.294),major_radius=.268,minor_radius=.077);scarf=bpy.context.object;scarf.scale=(1.13,1,1);finish(scarf,'Scarf',green,False)
scarf_end=orb('ScarfEnd',(.075,-.288,1.131),(.093,.04,.174),green,8,4);scarf_end.rotation_euler.y=-.18
leaf=ico('ScarfLeaf',(-.057,-.322,1.181),(.085,.025,.11),green);leaf.rotation_euler.y=-.48
fluff=ico('Tail',( .39,.31,.59),(.32,.24,.31),deep);fluff.rotation_euler.y=.65
fluff_tip=ico('TailTip',(.57,.37,.815),(.204,.191,.217),cream);fluff_tip.rotation_euler.y=.55

scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=48
scene.render.resolution_x=1000;scene.render.resolution_y=1000;scene.render.resolution_percentage=100;scene.render.film_transparent=True
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=-.1
world=bpy.data.worlds.new('StudioWorld');scene.world=world;world.use_nodes=True;world.node_tree.nodes.get('Background').inputs[0].default_value=(.7,.75,.72,1);world.node_tree.nodes.get('Background').inputs[1].default_value=.3
bpy.ops.object.camera_add(location=(3.2,-7,3.0));camera=bpy.context.object;camera.name='PreviewCamera';camera.data.type='ORTHO';camera.data.ortho_scale=3.25;scene.camera=camera
fixtures=[camera]
for loc,power,size in [((-3,-4,6),380,5),((4,-2,4),230,4),((0,4,5),400,4)]:
 bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(Vector((0,0,1.25))-light.location).to_track_quat('-Z','Y').to_euler();fixtures.append(light)
for name,loc in [('model-front',(0,-7,2.45)),('model-three-quarter',(3.2,-7,3.0)),('model-back',(3.2,7,2.8))]:
 camera.location=loc;camera.rotation_euler=(Vector((0,0,1.32))-camera.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=OUT+'/'+name+'.png';bpy.ops.render.render(write_still=True)
for o in fixtures:bpy.data.objects.remove(o,do_unlink=True)
scene.camera=None
bpy.ops.object.select_all(action='DESELECT')
for o in scene.objects:o.select_set(True)
bpy.context.view_layer.objects.active=bpy.data.objects.get('Head')
for screen in bpy.data.screens:
 for area in screen.areas:
  if area.type=='VIEW_3D':
   area.spaces.active.shading.type='MATERIAL';area.spaces.active.shading.use_scene_world=False;area.spaces.active.shading.use_scene_lights=False
   area.spaces.active.region_3d.view_distance=4.3;area.spaces.active.region_3d.view_location=(0,0,1.3);area.spaces.active.region_3d.view_rotation=Quaternion((.924,.383,0,0))
   area.spaces.active.overlay.show_overlays=False
bpy.ops.wm.save_as_mainfile(filepath=OUT+'/fox-v5-model.blend')
depsgraph=bpy.context.evaluated_depsgraph_get();triangles=0
for o in scene.objects:
 if o.type in ['MESH','CURVE']:
  evaluated=o.evaluated_get(depsgraph);mesh=evaluated.to_mesh();mesh.calc_loop_triangles();triangles+=len(mesh.loop_triangles);evaluated.to_mesh_clear()
print('MODEL_OBJECTS:',[(o.name,o.type) for o in scene.objects]);print('EVALUATED_TRIANGLES:',triangles);print('MATERIALS:',[(m.name,m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value) for m in [orange,deep,cream,blush,eyes,green]])
