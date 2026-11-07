import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../app/theme.dart';

/// 服务项数据
class ServiceItem {
  const ServiceItem({required this.icon, required this.label, required this.group, this.description = '', this.comingSoon = false});
  final IconData icon;
  final String label;
  final String group;
  final String description;
  final bool comingSoon;
}

class ServiceGroup {
  const ServiceGroup({required this.title, required this.items});
  final String title;
  final List<ServiceItem> items;
}

const _groups = <ServiceGroup>[
  ServiceGroup(title: '学习', items: [
    ServiceItem(icon: Icons.schedule, label: '课表', group: '学习', description: '查看本周课程安排与教室位置'),
    ServiceItem(icon: Icons.grade, label: '成绩', group: '学习', description: '查询各科目考试成绩与绩点'),
    ServiceItem(icon: Icons.event, label: '考试', group: '学习', description: '期末考试时间与考场安排'),
    ServiceItem(icon: Icons.calendar_today, label: '校历', group: '学习', description: '校历、节假日、校历周'),
    ServiceItem(icon: Icons.directions_run, label: '体测', group: '学习', description: '体测预约与成绩查询'),
    ServiceItem(icon: Icons.menu_book, label: '英语', group: '学习', description: '四六级报名与成绩'),
    ServiceItem(icon: Icons.quiz, label: '题库', group: '学习', description: '历年真题与练习'),
    ServiceItem(icon: Icons.psychology, label: 'AI 助手', group: '学习', description: '智能学习答疑助手', comingSoon: true),
  ]),
  ServiceGroup(title: '生活', items: [
    ServiceItem(icon: Icons.map, label: '校园地图', group: '生活', description: '校园建筑与导航'),
    ServiceItem(icon: Icons.directions_bus, label: '班车', group: '生活', description: '校区班车时刻表'),
    ServiceItem(icon: Icons.local_shipping, label: '快递', group: '生活', description: '快递点查询与取件码'),
    ServiceItem(icon: Icons.fitness_center, label: '运动', group: '生活', description: '运动场地预约'),
    ServiceItem(icon: Icons.account_balance_wallet, label: '校园卡', group: '生活', description: '校园卡充值与消费记录'),
    ServiceItem(icon: Icons.local_library, label: '图书馆', group: '生活', description: '座位预约与图书检索'),
    ServiceItem(icon: Icons.food_bank, label: '食堂', group: '生活', description: '食堂菜单与排队情况'),
    ServiceItem(icon: Icons.place, label: '打卡', group: '生活', description: '校园打卡与签到'),
  ]),
  ServiceGroup(title: '社交', items: [
    ServiceItem(icon: Icons.people_alt_outlined, label: '好友', group: '社交', description: '好友列表与添加'),
    ServiceItem(icon: Icons.chat_bubble_outline, label: '私信', group: '社交', description: '与好友私聊'),
    ServiceItem(icon: Icons.photo_camera_outlined, label: '朋友圈', group: '社交', description: '校园动态与朋友圈', comingSoon: true),
    ServiceItem(icon: Icons.handshake, label: '互助', group: '社交', description: '发布与参与互助任务'),
    ServiceItem(icon: Icons.shopping_bag_outlined, label: '二手', group: '社交', description: '校园闲置交易'),
    ServiceItem(icon: Icons.flag_outlined, label: '失物', group: '社交', description: '失物招领信息'),
  ]),
];

/// 最近使用状态
class RecentUsedNotifier extends StateNotifier<List<String>> {
  RecentUsedNotifier() : super(['课表', '成绩', '校园地图']);
  void use(String label) {
    state = [label, ...state.where((s) => s != label)].take(3).toList();
  }
}

final recentUsedProvider = StateNotifierProvider<RecentUsedNotifier, List<String>>((ref) => RecentUsedNotifier());

/// 服务页：搜索 + 最近使用 + 分组服务目录（双列线性图标）。
class ServicesPage extends ConsumerStatefulWidget {
  const ServicesPage({super.key});

  @override
  ConsumerState<ServicesPage> createState() => _ServicesPageState();
}

class _ServicesPageState extends ConsumerState<ServicesPage> {
  final _searchCtrl = TextEditingController();
  String _keyword = '';

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final recent = ref.watch(recentUsedProvider);
    final filteredGroups = _keyword.isEmpty
        ? _groups
        : _groups
            .map((g) => ServiceGroup(title: g.title, items: g.items.where((it) => it.label.contains(_keyword) || it.description.contains(_keyword)).toList()))
            .where((g) => g.items.isNotEmpty)
            .toList();

    return Scaffold(
      appBar: AppBar(title: const Text('服务')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: TextField(
              controller: _searchCtrl,
              onChanged: (v) => setState(() => _keyword = v.trim()),
              decoration: InputDecoration(
                hintText: '搜索服务',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _keyword.isNotEmpty
                    ? IconButton(icon: const Icon(Icons.clear), onPressed: () {
                        _searchCtrl.clear();
                        setState(() => _keyword = '');
                      })
                    : null,
                fillColor: Theme.of(context).colorScheme.surface,
                filled: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 0),
              ),
            ),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (_keyword.isEmpty) ...[
                  const _SectionTitle('最近使用'),
                  const SizedBox(height: 8),
                  _RecentUsed(labels: recent),
                  const SizedBox(height: 16),
                ],
                for (final g in filteredGroups) ...[
                  _SectionTitle(g.title),
                  const SizedBox(height: 8),
                  Card(
                    child: GridView.count(
                      crossAxisCount: 4,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      padding: const EdgeInsets.all(12),
                      mainAxisSpacing: 12,
                      crossAxisSpacing: 8,
                      childAspectRatio: 1,
                      children: [
                        for (final it in g.items)
                          InkWell(
                            onTap: () => _openService(context, it),
                            borderRadius: BorderRadius.circular(12),
                            child: Stack(
                              children: [
                                Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                                  Icon(it.icon, size: 24, color: OhuBrand.forest),
                                  const SizedBox(height: 6),
                                  Text(it.label, style: const TextStyle(fontSize: 12), textAlign: TextAlign.center),
                                ]),
                                if (it.comingSoon)
                                  Positioned(
                                    right: 4,
                                    top: 4,
                                    child: Container(padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1), decoration: BoxDecoration(color: OhuBrand.foxOrange, borderRadius: BorderRadius.circular(4)), child: const Text('soon', style: TextStyle(color: Colors.white, fontSize: 9))),
                                  ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
                if (filteredGroups.isEmpty)
                  const Padding(padding: EdgeInsets.all(40), child: Center(child: Text('没有找到相关服务', style: TextStyle(color: Colors.grey)))),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _openService(BuildContext context, ServiceItem item) {
    if (item.comingSoon) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${item.label} 即将上线')));
      return;
    }
    ref.read(recentUsedProvider.notifier).use(item.label);
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _ServiceDetailSheet(item: item),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title);
  final String title;
  @override
  Widget build(BuildContext context) => Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15));
}

class _RecentUsed extends ConsumerWidget {
  const _RecentUsed({required this.labels});
  final List<String> labels;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final all = [for (final g in _groups) ...g.items];
    final items = labels.map((l) => all.firstWhere((it) => it.label == l, orElse: () => const ServiceItem(icon: Icons.apps, label: '', group: ''))).where((it) => it.label.isNotEmpty).toList();
    if (items.isEmpty) return const SizedBox.shrink();
    return Row(
      children: [
        for (final it in items)
          Expanded(
            child: Card(
              child: InkWell(
                onTap: () {
                  ref.read(recentUsedProvider.notifier).use(it.label);
                  showModalBottomSheet(context: context, shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))), builder: (_) => _ServiceDetailSheet(item: it));
                },
                borderRadius: BorderRadius.circular(16),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  child: Column(children: [
                    Icon(it.icon, color: OhuBrand.forest, size: 24),
                    const SizedBox(height: 4),
                    Text(it.label, style: const TextStyle(fontSize: 12)),
                  ]),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _ServiceDetailSheet extends StatelessWidget {
  const _ServiceDetailSheet({required this.item});
  final ServiceItem item;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(child: Container(width: 36, height: 4, decoration: BoxDecoration(color: scheme.outlineVariant, borderRadius: BorderRadius.circular(2)))),
          const SizedBox(height: 20),
          Row(
            children: [
              Container(width: 56, height: 56, decoration: BoxDecoration(color: OhuBrand.mint, borderRadius: BorderRadius.circular(16)), child: Icon(item.icon, color: OhuBrand.forest, size: 28)),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(item.label, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 2),
                    Text(item.group, style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(item.description, style: const TextStyle(fontSize: 15, height: 1.6)),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: () {
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('正在打开 ${item.label}...')));
            },
            child: const Text('立即使用'),
          ),
        ],
      ),
    );
  }
}
