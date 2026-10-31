from pathlib import Path
from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

root = Path(__file__).resolve().parent
doc = Document()
section = doc.sections[0]
section.page_width, section.page_height = Cm(21), Cm(29.7)
section.top_margin = section.bottom_margin = Cm(2.25)
section.left_margin = section.right_margin = Cm(2.4)
normal = doc.styles['Normal']
normal.font.name = 'Microsoft YaHei'
normal._element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
normal.font.size = Pt(10.5)
normal.paragraph_format.line_spacing = 1.3
normal.paragraph_format.space_after = Pt(5)
for style_name in ['Title', 'Heading 1', 'Heading 2']:
    style = doc.styles[style_name]
    style.font.name = 'Microsoft YaHei'
    style._element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
    style.font.color.rgb = RGBColor.from_string('123E32')
header = section.header.paragraphs[0]
header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
header.add_run('软件使用说明书 · 草稿').italic = True
footer = section.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
footer.add_run('哦狐 1.2.140 · 申请材料草稿')

def heading(text): doc.add_heading(text, level=1)
def para(text): doc.add_paragraph(text)
def page(): doc.add_page_break()
def shot(filename, caption):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(str(root / '截图' / filename), height=Cm(11.3))
    p = doc.add_paragraph(caption)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.runs[0].italic = True

doc.add_paragraph('\n\n\n')
p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run('软件使用说明书'); r.bold = True; r.font.size = Pt(24)
p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.add_run('申请材料草稿').font.size = Pt(14)
doc.add_paragraph('\n')
for line in ['软件全称：哦狐', '软件版本号：1.2.140', '著作权人：王昊天', '编制日期：2026年11月11日']:
    p = doc.add_paragraph(line); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
para('\n说明：本稿依据当前本地项目与隔离环境中的页面整理，所用截图为未登录、未绑定课程状态。当前工作区标注 1.2.140 且含打包后的修改，提交前须确定源码基线并逐项复核。')
page()
heading('一、软件概述')
para('本软件是面向校园生活场景的移动应用，提供学习安排、校园服务、信息浏览和个人管理等入口。用户可以根据实际账号及校园服务的接入情况使用相关功能。')
para('主要模块包括：首页今日安排与常用功能、课程表、服务中心、校园广场及专注计时等。部分功能需要登录、绑定教务账号、联网或依赖外部服务，具体以实际部署版本和授权情况为准。')
heading('二、运行与使用准备')
para('本项目包含 Android 应用及 Web 界面。当前工程配置的 Android 最低系统版本为 Android 6.0（API 23）；设备兼容性、联网条件和最终支持范围应按申请版本测试结果填写。')
para('启动应用后可浏览公开页面；涉及账号数据和教务信息的功能，根据页面提示登录或绑定。网络连接、系统通知和其他权限由实际功能及用户授权情况决定。')
para('本说明书的界面图来自本地运行页面，未接入实际账号数据，不代表所有在线服务已完成验收。')
page()
heading('三、首页')
para('首页汇集今日安排、今日任务和常用功能。进入后可查看提示信息，并通过相应入口前往课表、待办和校园服务。未绑定课表时，页面提供绑定入口。')
shot('home.png', '图 1  首页（未绑定课表状态）')
page()
heading('四、课程表')
para('从首页或服务入口进入课表页面。尚未绑定时，可通过“绑定课表”进入相应流程；完成教务账号绑定与数据同步后，再按页面实际显示查看课程信息。页面同时提供提醒等入口。')
shot('schedule.png', '图 2  课表（未绑定状态）')
page()
heading('五、服务中心')
para('服务中心按类别汇集校园功能。用户可以通过搜索框或服务入口查找所需功能，进入相应页面。部分服务跳转第三方官方入口，使用效果取决于外部系统。')
shot('services.png', '图 3  服务中心')
page()
heading('六、校园广场')
para('校园广场提供校园动态等内容入口。用户可以在页面中切换内容类别、查看可用信息；发布和互动等操作可能需要登录并符合实际部署的权限设置。')
shot('plaza.png', '图 4  校园广场')
page()
heading('七、专注计时')
para('在专注页面选择需要的计时时长并开始专注。页面显示当前计时状态和相关操作；统计数据及提醒结果以实际使用与系统设置为准。')
shot('focus.png', '图 5  专注计时')
page()
heading('八、待办和个人设置')
para('通过待办入口查看和管理个人任务；具体字段、提醒与同步情况以所选版本的实际页面为准。用户可在个人页面进入设置，管理应用相关选项。')
heading('九、使用注意事项')
para('1. 请根据页面提示使用已授权的账号及校园服务，不同学校或部署环境可能具有不同的接入条件。')
para('2. 通知提醒受到系统通知权限、后台运行策略及设备设置影响，应在实际设备上检查。')
para('3. 本说明书使用当前工作区页面截图。申请材料的源码、说明书、软件名称和版本应保持一致，提交前应核实对应的代码基线及权属。')
doc.save(root / '软件使用说明书-草稿.docx')
