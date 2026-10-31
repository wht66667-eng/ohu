import importlib.util,sys,bpy
path=r'C:\Users\upwar\AppData\Local\uv\cache\archive-v0\gybvcAKXie89jQlm\Lib\site-packages\blender_mcp\bundled\addon.py'
spec=importlib.util.spec_from_file_location('ohfox_blender_mcp_addon',path)
addon=importlib.util.module_from_spec(spec);sys.modules[spec.name]=addon;spec.loader.exec_module(addon)
addon.register()
bpy.context.scene.blendermcp_use_polyhaven=False
bpy.context.scene.blendermcp_use_hyper3d=False
