"""Rebuild the lightweight fox campus props with Blender 5.2."""
import bpy, math, os
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
OUT = os.path.join(ROOT, 'design-system', 'fox-campus', 'runtime-assets')
os.makedirs(OUT, exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
def mat(name, color):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    shader=m.node_tree.nodes.get('Principled BSDF'); shader.inputs['Base Color'].default_value=(*color,1); shader.inputs['Roughness'].default_value=.42
    return m
green=mat('Campus emerald',(0.035,0.30,0.21)); dark=mat('Ear tips',(0.02,0.16,0.11))
orange=mat('Fox orange',(1,0.36,0.055)); cream=mat('Cream paper',(1,0.91,0.73))
mint=mat('Mint',(0.62,0.82,0.72)); gold=mat('Fox gold',(1,0.65,0.03))
def box(name, loc, scale, material, bevel=.08):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc); o=bpy.context.object; o.name=name
    o.dimensions=scale; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(material)
    if bevel:
        mod=o.modifiers.new('Soft edges','BEVEL'); mod.width=bevel; mod.segments=3
        o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return o
def sphere(name, loc, scale, material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, location=loc)
    o=bpy.context.object; o.name=name; o.scale=scale; o.data.materials.append(material); return o
def ear(x,z):
    vertices=[(x-.30,0,z),(x+.30,0,z),(x+.09,0,z+.65),(x-.30,.24,z),(x+.30,.24,z),(x+.09,.24,z+.65)]
    mesh=bpy.data.meshes.new('Fox ear'); mesh.from_pydata(vertices,[],[(0,1,2),(3,5,4),(0,3,4,1),(1,4,5,2),(2,5,3,0)])
    o=bpy.data.objects.new('Fox ear',mesh); bpy.context.collection.objects.link(o); o.data.materials.append(orange)
    tip_vertices=[(x-.066,-.012,z+.39),(x+.174,-.012,z+.39),(x+.09,-.012,z+.65),(x-.066,.25,z+.39),(x+.174,.25,z+.39),(x+.09,.25,z+.65)]
    mesh=bpy.data.meshes.new('Emerald triangular tip');mesh.from_pydata(tip_vertices,[],[(0,1,2),(3,5,4),(0,3,4,1),(1,4,5,2),(2,5,3,0)])
    tip=bpy.data.objects.new('Emerald triangular tip',mesh);bpy.context.collection.objects.link(tip);tip.data.materials.append(dark)
    mesh=bpy.data.meshes.new('Cream inner ear');mesh.from_pydata([(x-.19,-.025,z+.07),(x+.22,-.025,z+.07),(x+.09,-.025,z+.44)],[],[(0,1,2)])
    inner=bpy.data.objects.new('Cream inner ear',mesh);bpy.context.collection.objects.link(inner);inner.data.materials.append(cream)
def paw(loc, size=.14):
    x,y,z=loc; sphere('Paw pad',(x,y,z),(size,.055,size*.8),orange)
    for dx,dz in [(-.14,.14),(-.045,.21),(.065,.21),(.16,.12)]: sphere('Paw toe',(x+dx,y,z+dz),(size*.38,.05,size*.47),orange)
def clear_props():
    for o in list(bpy.data.objects):
        if o.type=='MESH': bpy.data.objects.remove(o,do_unlink=True)
scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=32
scene.render.resolution_x=512; scene.render.resolution_y=512; scene.render.resolution_percentage=100
scene.render.film_transparent=True; scene.render.image_settings.file_format='PNG'; scene.render.image_settings.color_mode='RGBA'
scene.world.color=(.6,.6,.6)
bpy.ops.object.camera_add(location=(3,-7,4)); camera=bpy.context.object
camera.rotation_euler=(Vector((0,0,1))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO'; camera.data.ortho_scale=3.8; scene.camera=camera
for loc,power,size in [((-3,-4,6),700,5),((4,-1,4),450,4),((1,4,5),650,3)]:
    bpy.ops.object.light_add(type='AREA',location=loc); l=bpy.context.object; l.data.energy=power; l.data.shape='DISK'; l.data.size=size
    l.rotation_euler=(Vector((0,0,1))-l.location).to_track_quat('-Z','Y').to_euler()
def render(name):
    scene.render.filepath=os.path.join(OUT,name+'.png'); bpy.ops.render.render(write_still=True)
    model_dir=os.path.join(ROOT,'design-system','fox-campus','models'); os.makedirs(model_dir,exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(model_dir,name+'.blend'))
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,name+'.glb'),export_format='GLB',use_selection=False,export_cameras=False,export_lights=False)

ear(-.65,1.55); ear(.65,1.55)
for i in range(2):
    z=.55+i*.52
    box('Book pages',(0,0,z),(1.95,1,.35),cream)
    for dz in [-.23,.23]: box('Emerald cover',(0,0,z+dz),(2.12,1.13,.09),green,.045)
    box('Book spine',(-1.01,0,z),(.16,1.09,.40),green)
paw((-.56,-.59,.51),.13); render('books')
clear_props(); ear(-.65,1.8); ear(.65,1.8)
box('Calendar frame',(0,0,1.13),(2.12,.32,1.7),green)
box('Calendar paper',(0,-.19,1.02),(1.88,.10,1.23),cream)
for x in [-.64,.64]: box('Binding',(x,-.10,1.95),(.12,.23,.38),mint,.05)
for row in range(2):
    for col in range(3): box('Calendar date',(-.57+col*.52,-.26,1.28-row*.4),(.25,.05,.21),mint,.04)
paw((.43,-.32,.66),.13); render('calendar')
clear_props(); ear(-.66,1.88); ear(.66,1.88)
box('Checklist frame',(0,0,1.15),(2,.32,1.9),green)
box('Checklist paper',(0,-.19,1.15),(1.77,.08,1.63),cream)
box('Clipboard clip',(0,-.21,2.02),(.73,.20,.27),orange)
for z in [1.65,1.18,.71]:
    a=box('Tick left',(-.55,-.26,z),(.13,.06,.25),green,.03); a.rotation_euler.y=-.7
    a=box('Tick right',(-.39,-.26,z+.05),(.13,.06,.41),green,.03); a.rotation_euler.y=.7
    box('Task line',(.28,-.25,z),( .74,.05,.075),mint,.02)
sphere('Paw badge',(.84,-.36,.45),(.41,.1,.41),orange)
sphere('Badge pad',(.84,-.48,.40),(.15,.035,.12),cream)
for dx,dz in [(-.18,.12),(-.06,.23),(.08,.23),(.20,.11)]: sphere('Badge toe',(.84+dx,-.48,.4+dz),(.065,.035,.085),cream)
render('checklist')
clear_props()
# A real, editable low-poly mascot for the interactive model viewer.
sphere('Hoodie body',(0,0,.95),(.46,.30,.60),green)
box('Shorts',(0,0,.48),(.78,.49,.34),dark)
for x in [-.24,.24]:
    sphere('Leg',(x,0,.27),(.16,.16,.25),orange)
    sphere('Cream shoe',(x,-.10,.11),(.23,.30,.13),cream)
sphere('Fox head',(0,-.04,1.92),(.78,.47,.65),orange)
sphere('Cream muzzle',(0,-.36,1.68),(.69,.23,.29),cream)
ear(-.54,2.21); ear(.54,2.21)
for x in [-.29,.29]:
    sphere('Cream eye patch',(x,-.44,1.91),(.21,.09,.26),cream)
    sphere('Emerald eye',(x,-.525,1.94),(.105,.045,.16),dark)
    sphere('Eye shine',(x-.028,-.567,2.01),(.035,.017,.045),cream)
    brow=box('Eyebrow',(x,-.46,2.23),(.19,.035,.055),dark,.02); brow.rotation_euler.y=.15 if x<0 else -.15
sphere('Nose',(0,-.615,1.74),(.105,.07,.065),dark)
for x in [-.10,.10]:
    smile=box('Smile',(x,-.593,1.59),(.16,.025,.035),dark,.015); smile.rotation_euler.y=.35 if x<0 else -.35
for x in [-.53,.53]:
    sphere('Sleeve',(x,0,1.05),(.20,.23,.39),green)
    sphere('Paw',(x,-.02,.76),(.18,.19,.19),orange)
box('Backpack',(0,.33,1.08),(.67,.27,.67),dark)
for x in [-.30,.30]: box('Backpack strap',(x,-.265,1.08),(.08,.06,.65),dark,.03)
for x in [-.11,.11]:
    book=box('Open book badge',(x,-.31,1.05),(.19,.03,.25),cream,.015); book.rotation_euler.y=.15 if x<0 else -.15
tail=sphere('Tail',( .45,.35,.55),(.25,.23,.57),orange); tail.rotation_euler.y=.85
tip=sphere('Cream tail tip',(.75,.35,.82),(.20,.23,.28),cream); tip.rotation_euler.y=.85
camera.data.ortho_scale=3.65
camera.location=(3,-8,3.2); camera.rotation_euler=(Vector((0,0,1.4))-camera.location).to_track_quat('-Z','Y').to_euler()
render('mascot')
