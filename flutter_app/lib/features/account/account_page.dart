import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../app/theme.dart';
import '../home/widgets.dart';

/// 我的页：品牌头 → 资料卡 → 问候卡 → 快捷入口 → 成长记录 → 学习与发布 → 我的社交。
class AccountPage extends ConsumerWidget {
  const AccountPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).user;
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            pinned: true,
            backgroundColor: OhuBrand.ivory,
            elevation: 0,
            title: const Text('我的', style: TextStyle(color: OhuBrand.forest, fontWeight: FontWeight.bold)),
            centerTitle: true,
            actions: [
              IconButton(icon: const Icon(Icons.settings_outlined, color: OhuBrand.forest), onPressed: () => context.push('/settings')),
            ],
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('OHU · MY CAMPUS', style: TextStyle(color: OhuBrand.forest, fontSize: 12, letterSpacing: 1)),
                  const SizedBox(height: 4),
                  const Text('我的校园生活', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 4),
                  Text('每一个努力的日子，都值得被记录。', style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13)),
                  const SizedBox(height: 16),
                  _ProfileCard(user: user),
                  const SizedBox(height: 12),
                  const _GreetingCard(),
                  const SizedBox(height: 12),
                  _QuickActions(user: user),
                  const SizedBox(height: 12),
                  const _GrowthCard(),
                  const SizedBox(height: 16),
                  const Text('学习与发布', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                  const SizedBox(height: 10),
                  _SectionGrid(items: const [
                    (icon: Icons.bookmark_border, label: '我的收藏'),
                    (icon: Icons.shopping_bag_outlined, label: '闲置发布'),
                    (icon: Icons.assignment_outlined, label: '我的待办'),
                  ]),
                  const SizedBox(height: 16),
                  const Text('我的社交', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                  const SizedBox(height: 10),
                  _SectionGrid(items: const [
                    (icon: Icons.people_alt_outlined, label: '我的好友'),
                    (icon: Icons.photo_camera_outlined, label: '我的动态'),
                    (icon: Icons.favorite_border, label: '我的点赞'),
                  ]),
                  const SizedBox(height: 16),
                  const _NfcCard(),
                  if (user != null) ...[
                    const SizedBox(height: 20),
                    SizedBox(width: double.infinity, child: FilledButton.tonal(onPressed: () => ref.read(authControllerProvider.notifier).logout(), child: const Text('退出登录'))),
                  ],
                  const SizedBox(height: 24),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileCard extends ConsumerWidget {
  const _ProfileCard({required this.user});
  final dynamic user;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            const FoxAvatar(size: 52),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(user?.nickname?.toString().isNotEmpty == true ? user.nickname : '点击登录', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 2),
                  Container(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1), decoration: BoxDecoration(color: OhuBrand.mint, borderRadius: BorderRadius.circular(4)), child: Text(user?.isAdmin == true ? '管理员' : '学生', style: const TextStyle(color: OhuBrand.forest, fontSize: 11))),
                ],
              ),
            ),
            OutlinedButton(
              onPressed: () {
                if (user == null) {
                  context.push('/login');
                } else {
                  _showProfileEdit(context, ref, user);
                }
              },
              child: Text(user == null ? '登录' : '编辑资料'),
            ),
          ],
        ),
      ),
    );
  }

  void _showProfileEdit(BuildContext context, WidgetRef ref, dynamic user) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _ProfileEditSheet(user: user),
    );
  }
}

class _ProfileEditSheet extends StatefulWidget {
  const _ProfileEditSheet({required this.user});
  final dynamic user;

  @override
  State<_ProfileEditSheet> createState() => _ProfileEditSheetState();
}

class _ProfileEditSheetState extends State<_ProfileEditSheet> {
  late final TextEditingController _nickCtrl;
  late final TextEditingController _bioCtrl;
  String _grade = '大二';
  String _major = '计算机科学';

  @override
  void initState() {
    super.initState();
    _nickCtrl = TextEditingController(text: widget.user?.nickname?.toString() ?? '');
    _bioCtrl = TextEditingController(text: '热爱学习，热爱生活～');
  }

  @override
  void dispose() {
    _nickCtrl.dispose();
    _bioCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(child: Container(width: 36, height: 4, decoration: BoxDecoration(color: Theme.of(context).colorScheme.outlineVariant, borderRadius: BorderRadius.circular(2)))),
            const SizedBox(height: 16),
            Text('编辑资料', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            TextField(controller: _nickCtrl, decoration: const InputDecoration(labelText: '昵称', border: OutlineInputBorder())),
            const SizedBox(height: 12),
            TextField(controller: _bioCtrl, maxLines: 2, decoration: const InputDecoration(labelText: '个性签名', border: OutlineInputBorder())),
            const SizedBox(height: 12),
            InputDecorator(
              decoration: const InputDecoration(labelText: '年级', border: OutlineInputBorder()),
              child: DropdownButton<String>(
                value: _grade,
                isExpanded: true,
                underline: const SizedBox(),
                items: ['大一', '大二', '大三', '大四', '研究生'].map((g) => DropdownMenuItem(value: g, child: Text(g))).toList(),
                onChanged: (v) => setState(() => _grade = v ?? _grade),
              ),
            ),
            const SizedBox(height: 12),
            TextField(controller: TextEditingController(text: _major), decoration: const InputDecoration(labelText: '专业', border: OutlineInputBorder()), onChanged: (v) => _major = v),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () {
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('资料已保存')));
                },
                child: const Text('保存'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GreetingCard extends StatelessWidget {
  const _GreetingCard();
  @override
  Widget build(BuildContext context) {
    return Card(
      color: OhuBrand.cream,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(width: 56, height: 56, decoration: BoxDecoration(color: OhuBrand.mint, shape: BoxShape.circle), child: const Icon(Icons.pets, color: OhuBrand.foxOrange, size: 32)),
            const SizedBox(width: 14),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('今天也有小美好', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                  SizedBox(height: 2),
                  Text('和阿狐打个招呼，继续你的校园日常。', style: TextStyle(fontSize: 13, color: Colors.grey)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuickActions extends StatelessWidget {
  const _QuickActions({required this.user});
  final dynamic user;
  static const _items = <({IconData icon, String label, String sub})>[
    (icon: Icons.schedule, label: '我的课表', sub: '课程日程'),
    (icon: Icons.place, label: '地图打卡', sub: '地点与打卡'),
    (icon: Icons.assignment, label: '待办任务', sub: '学习与生活'),
    (icon: Icons.notifications_none, label: '通知消息', sub: '课程与系统'),
  ];

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: Row(
          children: [
            for (final it in _items)
              Expanded(
                child: GestureDetector(
                  onTap: () => _onTap(context, it.label),
                  child: Column(children: [
                    Container(width: 44, height: 44, decoration: BoxDecoration(color: OhuBrand.mint, borderRadius: BorderRadius.circular(14)), child: Icon(it.icon, color: OhuBrand.forest)),
                    const SizedBox(height: 6),
                    Text(it.label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 1),
                    Text(it.sub, style: TextStyle(fontSize: 11, color: Theme.of(context).colorScheme.onSurfaceVariant)),
                  ]),
                ),
              ),
          ],
        ),
      ),
    );
  }

  void _onTap(BuildContext context, String label) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('已进入 $label')));
  }
}

class _GrowthCard extends StatelessWidget {
  const _GrowthCard();
  @override
  Widget build(BuildContext context) {
    return Card(
      color: OhuBrand.cream,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('用心记录每一次成长', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                  SizedBox(height: 6),
                  Text('今天也和阿狐一起，向喜欢的生活前进一步。', style: TextStyle(fontSize: 13, color: Colors.grey)),
                ],
              ),
            ),
            Container(width: 64, height: 64, decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)), child: const Icon(Icons.menu_book, color: OhuBrand.forest, size: 36)),
          ],
        ),
      ),
    );
  }
}

class _SectionGrid extends StatelessWidget {
  const _SectionGrid({required this.items});
  final List<({IconData icon, String label})> items;
  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: Row(
          children: [
            for (final it in items)
              Expanded(
                child: GestureDetector(
                  onTap: () => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('已进入 ${it.label}'))),
                  child: Column(children: [
                    Container(width: 44, height: 44, decoration: BoxDecoration(color: OhuBrand.mint, borderRadius: BorderRadius.circular(14)), child: Icon(it.icon, color: OhuBrand.forest)),
                    const SizedBox(height: 6),
                    Text(it.label, style: const TextStyle(fontSize: 13)),
                  ]),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// NFC 校园名片
class _NfcCard extends StatelessWidget {
  const _NfcCard();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(22),
        onTap: () => _showNfcDetail(context),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(width: 40, height: 40, decoration: BoxDecoration(color: OhuBrand.mint, borderRadius: BorderRadius.circular(12)), child: const Icon(Icons.nfc, color: OhuBrand.forest)),
                  const SizedBox(width: 10),
                  const Expanded(child: Text('我的校园名片', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15))),
                  Icon(Icons.chevron_right, color: scheme.onSurfaceVariant),
                ],
              ),
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(colors: [OhuBrand.forest, Color(0xFF2D7A4F)], begin: Alignment.topLeft, end: Alignment.bottomRight),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Row(
                  children: [
                    const FoxAvatar(size: 48, backgroundColor: Colors.white),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: const [
                          Text('哦狐同学', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                          SizedBox(height: 2),
                          Text('ID: ohu_2024', style: TextStyle(color: Colors.white70, fontSize: 12)),
                          SizedBox(height: 4),
                          Text('计算机科学 · 大二', style: TextStyle(color: Colors.white70, fontSize: 12)),
                        ],
                      ),
                    ),
                    const Icon(Icons.nfc, color: Colors.white, size: 32),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              Text('点击查看 / 碰一碰加好友', style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12)),
            ],
          ),
        ),
      ),
    );
  }

  void _showNfcDetail(BuildContext context) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(child: Container(width: 36, height: 4, decoration: BoxDecoration(color: Theme.of(context).colorScheme.outlineVariant, borderRadius: BorderRadius.circular(2)))),
            const SizedBox(height: 20),
            const Text('校园名片', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold), textAlign: TextAlign.center),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                gradient: const LinearGradient(colors: [OhuBrand.forest, Color(0xFF2D7A4F)]),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Column(
                children: [
                  const FoxAvatar(size: 72, backgroundColor: Colors.white),
                  const SizedBox(height: 12),
                  const Text('哦狐同学', style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 4),
                  const Text('ohu_2024', style: TextStyle(color: Colors.white70)),
                  const SizedBox(height: 4),
                  const Text('计算机科学 · 大二', style: TextStyle(color: Colors.white70, fontSize: 13)),
                  const SizedBox(height: 16),
                  Container(
                    width: 140,
                    height: 140,
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
                    child: CustomPaint(
                      painter: _QrPainter(),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: () {
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('NFC 碰一碰功能需要在真机上使用')));
              },
              icon: const Icon(Icons.nfc),
              label: const Text('碰一碰加好友'),
            ),
          ],
        ),
      ),
    );
  }
}

/// 简易二维码样式绘制
class _QrPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = OhuBrand.forest;
    const cell = 8.0;
    final cols = (size.width / cell).floor();
    final rows = (size.height / cell).floor();
    // 伪随机二维码点阵
    for (int r = 0; r < rows; r++) {
      for (int c = 0; c < cols; c++) {
        if ((r * 7 + c * 13 + r * c) % 3 == 0) {
          canvas.drawRect(Rect.fromLTWH(c * cell, r * cell, cell, cell), paint);
        }
      }
    }
    // 三个定位角
    final corner = Paint()..color = OhuBrand.forest;
    final bg = Paint()..color = Colors.white;
    for (final pos in [const Offset(0, 0), Offset(size.width - cell * 7, 0), Offset(0, size.height - cell * 7)]) {
      canvas.drawRect(Rect.fromLTWH(pos.dx, pos.dy, cell * 7, cell * 7), corner);
      canvas.drawRect(Rect.fromLTWH(pos.dx + cell, pos.dy + cell, cell * 5, cell * 5), bg);
      canvas.drawRect(Rect.fromLTWH(pos.dx + cell * 2, pos.dy + cell * 2, cell * 3, cell * 3), corner);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
