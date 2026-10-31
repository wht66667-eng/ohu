import bpy
from mathutils import Vector
for screen in bpy.data.screens:
 for area in screen.areas:
  if area.type=='VIEW_3D':
   region=area.spaces.active.region_3d
   region.view_location=Vector((0,0,1.32));region.view_distance=4.1
   region.view_rotation=(Vector((0,0,1.32))-Vector((3.2,-7,3))).to_track_quat('-Z','Y')
   region.view_perspective='ORTHO'
   area.tag_redraw()
bpy.ops.wm.save_as_mainfile(filepath=r'C:/Users/upwar/Desktop/新建文件夹 (6)/design-system/ui-v5/fox-v5-model.blend')
print('Viewport aligned to three-quarter model preview; only fox parts in scene.')
