import asyncio,base64,json,os,sys
from pathlib import Path
from mcp import ClientSession,StdioServerParameters
from mcp.client.stdio import stdio_client
ROOT=Path(__file__).resolve().parents[2]
async def main():
 params=StdioServerParameters(command=r'C:\Users\upwar\.local\bin\uvx.exe',args=['mcp-for-blender','--host','localhost','--port','9876'],env={**os.environ,'BLENDER_MCP_DISABLE_TELEMETRY':'1'})
 async with stdio_client(params) as (read,write):
  async with ClientSession(read,write) as session:
   await session.initialize()
   mode=sys.argv[1]
   if mode=='list':
    result=await session.list_tools()
    print(json.dumps([{'name':t.name,'schema':t.inputSchema} for t in result.tools if t.name in ['get_scene_info','get_viewport_screenshot','execute_blender_code','describe_node_type']],ensure_ascii=False));return
   args={'user_prompt':'按这个给第5个ui安装包'}
   name={'scene':'get_scene_info','code':'execute_blender_code','schema':'describe_node_type','screen':'get_viewport_screenshot'}[mode]
   if mode=='code':args['code']=Path(sys.argv[2]).read_text(encoding='utf-8-sig')
   if mode=='schema':args['bl_idname']='ShaderNodeBsdfPrincipled'
   if mode=='screen':args['max_size']=1200
   result=await session.call_tool(name,args)
   output=[]
   for item in result.content:
    if item.type=='text':output.append(item.text)
    elif item.type=='image':
     path=ROOT/'design-system/ui-v5/model-viewport.png';path.write_bytes(base64.b64decode(item.data));print('Screenshot saved:',path)
   (ROOT/'design-system/ui-v5'/('mcp-'+mode+'.json')).write_text(json.dumps(result.model_dump(mode='json'),ensure_ascii=False,indent=2),encoding='utf-8')
   print('\n'.join(output))
   if result.isError or any('Error executing code:' in t for t in output):raise RuntimeError('Blender MCP command failed')
asyncio.run(main())
