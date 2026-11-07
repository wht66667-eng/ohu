import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../app/theme.dart';
import 'widgets.dart';

/// 今日任务状态管理
class TaskItem {
  const TaskItem({required this.id, required this.title, required this.due, this.done = false});
  final String id;
  final String title;
  final String due;
  final bool done;
  TaskItem copyWith({bool? done}) => TaskItem(id: id, title: title, due: due, done: done ?? this.done);
}

class TaskNotifier extends StateNotifier<List<TaskItem>> {
  TaskNotifier() : super(const [
    TaskItem(id: '1', title: '本地样例 · 整理英语课堂笔记', due: '今天 21:24'),
    TaskItem(id: '2', title: '本地样例 · 复习数据结构', due: '明天 17:24'),
  ]);
  void toggle(String id) => state = [for (final t in state) t.id == id ? t.copyWith(done: !t.done) : t];
}

final taskProvider = StateNotifierProvider<TaskNotifier, List<TaskItem>>((ref) => TaskNotifier());

/// 首页：校区选择 → 品牌横幅 → 今日安排 → 今日任务 → 常用功能 → 校园动态 → 同学互助。
class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            pinned: true,
            leading: IconButton(icon: const Icon(Icons.arrow_back_ios_new, size: 18), onPressed: () {}),
            title: const Text('首页'),
            centerTitle: true,
            actions: [
              IconButton(icon: const Icon(Icons.search), onPressed: () {}),
              IconButton(icon: const Icon(Icons.notifications_none), onPressed: () {}),
            ],
          ),
          SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: const [
                _SubTabs(),
                _CampusSelector(),
                Padding(padding: EdgeInsets.fromLTRB(16, 8, 16, 0), child: BrandBanner()),
                SizedBox(height: 12),
                _TodayScheduleCard(),
                SizedBox(height: 12),
                _TodayTaskCard(),
                SizedBox(height: 12),
                _CommonFunctions(),
                SizedBox(height: 12),
                _CampusUpdates(),
                SizedBox(height: 12),
                _PeerHelp(),
                SizedBox(height: 16),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SubTabs extends StatelessWidget {
  const _SubTabs();
  @override
  Widget build(BuildContext context) {
    const tabs = ['首页', '课表', '消息/好友', '私信', '提醒设置'];
    return SizedBox(
      height: 40,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: tabs.length,
        separatorBuilder: (_, _) => const SizedBox(width: 22),
        itemBuilder: (context, i) => Center(
          child: Text(
            tabs[i],
            style: TextStyle(
              fontSize: 14,
              fontWeight: i == 0 ? FontWeight.w700 : FontWeight.w500,
              color: i == 0 ? OhuBrand.forest : Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
        ),
      ),
    );
  }
}

class _CampusSelector extends StatelessWidget {
  const _CampusSelector();
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      child: Row(
        children: [
          Icon(Icons.location_on_outlined, size: 16, color: Theme.of(context).colorScheme.onSurfaceVariant),
          const SizedBox(width: 4),
          Text('选择校区', style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 13)),
          Icon(Icons.expand_more, size: 16, color: Theme.of(context).colorScheme.onSurfaceVariant),
          const Spacer(),
          Icon(Icons.wb_sunny_outlined, size: 16, color: OhuBrand.foxOrange),
          const SizedBox(width: 4),
          Text('本地样例 · 合成晴天 22°', style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant, fontSize: 13)),
        ],
      ),
    );
  }
}

class _TodayScheduleCard extends StatelessWidget {
  const _TodayScheduleCard();
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => _showScheduleDetail(context),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                const Icon(Icons.calendar_today, size: 18, color: OhuBrand.forest),
                const SizedBox(width: 6),
                Text('今日安排', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                const Spacer(),
                TextButton(onPressed: () => _showScheduleDetail(context), child: const Text('完整课表')),
              ]),
              const SizedBox(height: 4),
              Text('11月4日 星期二', style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13)),
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(color: OhuBrand.mint, borderRadius: BorderRadius.circular(14)),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('17:40', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: OhuBrand.forest)),
                        Text('19:45', style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13)),
                      ],
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('周末选修 · 本地样例', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                          const SizedBox(height: 4),
                          Text('样例教学楼 E203 · 样例教师庚', style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13)),
                          const SizedBox(height: 8),
                          Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2), decoration: BoxDecoration(color: OhuBrand.foxOrange, borderRadius: BorderRadius.circular(6)), child: const Text('下一节课 · 16分钟后开始', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600))),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              Text('课表更新于 今天 17:24', style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12)),
            ],
          ),
        ),
      ),
    );
  }

  void _showScheduleDetail(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => const _ScheduleSheet(),
    );
  }
}

class _ScheduleSheet extends StatelessWidget {
  const _ScheduleSheet();
  @override
  Widget build(BuildContext context) {
    final courses = const [
      (time: '08:00-09:40', name: '高等数学', loc: '文渊楼 201'),
      (time: '10:00-11:40', name: '大学英语', loc: '文苑楼 305'),
      (time: '14:00-15:40', name: '数据结构', loc: '计算机楼 102'),
      (time: '17:40-19:45', name: '周末选修', loc: '样例教学楼 E203'),
    ];
    return DraggableScrollableSheet(
      initialChildSize: 0.7,
      minChildSize: 0.4,
      expand: false,
      builder: (context, scroll) => ListView(
        controller: scroll,
        padding: const EdgeInsets.all(16),
        children: [
          Center(child: Container(width: 36, height: 4, decoration: BoxDecoration(color: Theme.of(context).colorScheme.outlineVariant, borderRadius: BorderRadius.circular(2)))),
          const SizedBox(height: 16),
          Text('完整课表', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text('11月4日 星期二', style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
          const SizedBox(height: 16),
          for (final c in courses)
            Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Text(c.time.split('-')[0], style: const TextStyle(fontWeight: FontWeight.bold)),
                  Text(c.time.split('-')[1], style: TextStyle(fontSize: 11, color: Theme.of(context).colorScheme.onSurfaceVariant)),
                ]),
                title: Text(c.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text(c.loc),
              ),
            ),
        ],
      ),
    );
  }
}

class _TodayTaskCard extends ConsumerWidget {
  const _TodayTaskCard();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tasks = ref.watch(taskProvider);
    final doneCount = tasks.where((t) => t.done).length;
    final scheme = Theme.of(context).colorScheme;
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              const Icon(Icons.check_circle_outline, size: 18, color: OhuBrand.forest),
              const SizedBox(width: 6),
              Text('今日任务', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
              const Spacer(),
              Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2), decoration: BoxDecoration(color: OhuBrand.cream, borderRadius: BorderRadius.circular(8)), child: Text('$doneCount/${tasks.length}', style: const TextStyle(color: OhuBrand.forest, fontWeight: FontWeight.w700, fontSize: 13))),
              const SizedBox(width: 8),
              TextButton(onPressed: () {}, child: const Text('全部待办')),
            ]),
            const SizedBox(height: 8),
            for (final t in tasks)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: Row(children: [
                  InkWell(
                    onTap: () => ref.read(taskProvider.notifier).toggle(t.id),
                    child: Icon(
                      t.done ? Icons.check_circle : Icons.radio_button_unchecked,
                      size: 22,
                      color: t.done ? OhuBrand.forest : scheme.primary,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      t.title,
                      style: TextStyle(
                        fontSize: 14,
                        decoration: t.done ? TextDecoration.lineThrough : null,
                        color: t.done ? scheme.onSurfaceVariant : null,
                      ),
                    ),
                  ),
                  Text(t.due, style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12)),
                ]),
              ),
          ],
        ),
      ),
    );
  }
}

class _CommonFunctions extends StatelessWidget {
  const _CommonFunctions();
  static const _items = <({IconData icon, String label, Color color})>[
    (icon: Icons.schedule, label: '课表', color: OhuBrand.forest),
    (icon: Icons.chat_bubble_outline, label: '消息/好友', color: OhuBrand.foxOrange),
    (icon: Icons.language, label: '英语学习', color: Color(0xFF5B8DEF)),
  ];

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(children: [
              const Icon(Icons.extension, size: 18, color: OhuBrand.forest),
              const SizedBox(width: 6),
              Text('常用功能', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
              const Spacer(),
              TextButton(onPressed: () {}, child: const Text('调整')),
              TextButton(onPressed: () {}, child: const Text('全部服务')),
            ]),
            const SizedBox(height: 4),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                for (final it in _items)
                  Expanded(
                    child: GestureDetector(
                      onTap: () {},
                      child: Column(
                        children: [
                          Container(width: 52, height: 52, decoration: BoxDecoration(color: it.color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(16)), child: Icon(it.icon, color: it.color)),
                          const SizedBox(height: 6),
                          Text(it.label, style: const TextStyle(fontSize: 12)),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _CampusUpdates extends StatelessWidget {
  const _CampusUpdates();
  static const _items = <({IconData icon, String tag, String title})>[
    (icon: Icons.campaign, tag: '公告', title: '本地样例 · 阅读空间开放说明'),
    (icon: Icons.event_available, tag: '活动', title: '本地样例 · 课程笔记交流'),
    (icon: Icons.flag_outlined, tag: '失物', title: '本地样例 · 水杯招领'),
  ];

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              const Icon(Icons.campaign, size: 18, color: OhuBrand.forest),
              const SizedBox(width: 6),
              Text('校园动态', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
              const Spacer(),
              TextButton(onPressed: () {}, child: const Text('查看着全部')),
            ]),
            const SizedBox(height: 4),
            for (var i = 0; i < _items.length; i++) ...[
              if (i > 0) const Divider(height: 24),
              Row(children: [
                Icon(_items[i].icon, size: 18, color: scheme.primary),
                const SizedBox(width: 8),
                Container(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1), decoration: BoxDecoration(color: scheme.primaryContainer, borderRadius: BorderRadius.circular(4)), child: Text(_items[i].tag, style: TextStyle(color: scheme.onPrimaryContainer, fontSize: 11))),
                const SizedBox(width: 10),
                Expanded(child: Text(_items[i].title, style: const TextStyle(fontSize: 14))),
                Icon(Icons.chevron_right, size: 18, color: scheme.onSurfaceVariant),
              ]),
            ],
          ],
        ),
      ),
    );
  }
}

class _PeerHelp extends StatelessWidget {
  const _PeerHelp();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    const items = [
      (title: '帮取教材', loc: '样例教学楼', time: '11/4 17:23', reward: '¥8', status: '待接单'),
      (title: '闲置教材', loc: '样例教学楼 · 样例', time: '', reward: '¥12', status: '在售'),
      (title: '一起整理课程笔记', loc: '样例阅览室', time: '11/4 17:21', reward: '¥0', status: '进行中'),
    ];
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              const Icon(Icons.handshake, size: 18, color: OhuBrand.forest),
              const SizedBox(width: 6),
              Text('同学互助', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
            ]),
            const SizedBox(height: 12),
            for (final it in items)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(width: 36, height: 36, decoration: BoxDecoration(color: OhuBrand.mint, borderRadius: BorderRadius.circular(10)), child: const Icon(Icons.assignment, color: OhuBrand.forest, size: 18)),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(it.title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                          const SizedBox(height: 2),
                          Text('${it.loc}${it.time.isNotEmpty ? ' · ${it.time}' : ''}', style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12)),
                        ],
                      ),
                    ),
                    Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                      Text(it.reward, style: const TextStyle(fontWeight: FontWeight.w700, color: OhuBrand.foxOrange)),
                      const SizedBox(height: 2),
                      Text(it.status, style: TextStyle(color: it.status == '进行中' ? OhuBrand.forest : (it.status == '待接单' ? OhuBrand.foxOrange : scheme.onSurfaceVariant), fontSize: 11)),
                    ]),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
