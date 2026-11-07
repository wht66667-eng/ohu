import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/theme.dart';
import '../features/account/account_page.dart';
import '../features/account/login_page.dart';
import '../features/discover/plaza_page.dart';
import '../features/home/home_page.dart';
import '../features/services/services_page.dart';
import '../features/settings/settings_page.dart';

/// 底部主导航：首页 / 服务 / [发布圆钮] / 广场 / 我的。
/// 中央发布键为独立圆形按钮，点击弹出发布面板。
class MainShell extends ConsumerWidget {
  const MainShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  static const _tabs = <({String label, IconData icon})>[
    (label: '首页', icon: Icons.home_outlined),
    (label: '服务', icon: Icons.grid_view_outlined),
    (label: '广场', icon: Icons.public),
    (label: '我的', icon: Icons.person_outline),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: scheme.surface,
          border: Border(top: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.4))),
        ),
        child: SafeArea(
          top: false,
          child: SizedBox(
            height: 64,
            child: Row(
              children: [
                Expanded(child: _NavItem(tab: _tabs[0], index: 0, shell: navigationShell)),
                Expanded(child: _NavItem(tab: _tabs[1], index: 1, shell: navigationShell)),
                // 中央发布圆钮
                SizedBox(
                  width: 72,
                  child: GestureDetector(
                    onTap: () => _showPublishSheet(context),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(
                            color: scheme.primary,
                            shape: BoxShape.circle,
                            boxShadow: [BoxShadow(color: scheme.primary.withValues(alpha: 0.35), blurRadius: 8, offset: const Offset(0, 3))],
                          ),
                          child: Icon(Icons.add, color: scheme.onPrimary, size: 26),
                        ),
                        const SizedBox(height: 2),
                        Text('发布', style: TextStyle(fontSize: 11, color: scheme.primary, fontWeight: FontWeight.w600)),
                      ],
                    ),
                  ),
                ),
                Expanded(child: _NavItem(tab: _tabs[2], index: 2, shell: navigationShell)),
                Expanded(child: _NavItem(tab: _tabs[3], index: 3, shell: navigationShell)),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _showPublishSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => _PublishSheet(onItem: (label) {
        Navigator.pop(ctx);
        // 跳转到广场页并提示
        final shell = navigationShell;
        shell.goBranch(2); // 广场
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('在广场发布「$label」')));
      }),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({required this.tab, required this.index, required this.shell});
  final ({String label, IconData icon}) tab;
  final int index;
  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    // 发布钮占了第 3 位（index 2），所以 shell index 映射：0→0, 1→1, 2→2(广场), 3→3(我的)
    final shellIndex = index;
    final active = shell.currentIndex == shellIndex;
    return InkWell(
      onTap: () => shell.goBranch(shellIndex),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(tab.icon, color: active ? scheme.primary : scheme.onSurfaceVariant, size: 24),
          const SizedBox(height: 2),
          Text(tab.label, style: TextStyle(fontSize: 11, color: active ? scheme.primary : scheme.onSurfaceVariant, fontWeight: active ? FontWeight.w600 : FontWeight.normal)),
        ],
      ),
    );
  }
}

class _PublishSheet extends StatelessWidget {
  const _PublishSheet({required this.onItem});
  final void Function(String label) onItem;

  static const _items = <({IconData icon, String label, Color color})>[
    (icon: Icons.photo_camera_outlined, label: '发动态', color: OhuBrand.foxOrange),
    (icon: Icons.shopping_bag_outlined, label: '发闲置', color: OhuBrand.forest),
    (icon: Icons.help_outline, label: '求助', color: Color(0xFF5B8DEF)),
    (icon: Icons.handshake, label: '互助', color: Color(0xFF8B5CF6)),
  ];

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(child: Container(width: 36, height: 4, decoration: BoxDecoration(color: Theme.of(context).colorScheme.outlineVariant, borderRadius: BorderRadius.circular(2)))),
          const SizedBox(height: 20),
          Text('发布', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              for (final it in _items)
                GestureDetector(
                  onTap: () => onItem(it.label),
                  child: Column(
                    children: [
                      Container(
                        width: 52,
                        height: 52,
                        decoration: BoxDecoration(color: it.color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(16)),
                        child: Icon(it.icon, color: it.color),
                      ),
                      const SizedBox(height: 6),
                      Text(it.label, style: const TextStyle(fontSize: 12)),
                    ],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}

final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/home',
    routes: [
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => MainShell(navigationShell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/home', builder: (_, _) => const HomePage())]),
          StatefulShellBranch(routes: [GoRoute(path: '/services', builder: (_, _) => const ServicesPage())]),
          StatefulShellBranch(routes: [GoRoute(path: '/plaza', builder: (_, _) => const PlazaPage())]),
          StatefulShellBranch(routes: [GoRoute(path: '/account', builder: (_, _) => const AccountPage())]),
        ],
      ),
      GoRoute(path: '/login', builder: (_, _) => const LoginPage()),
      GoRoute(path: '/settings', builder: (_, _) => const SettingsPage()),
    ],
  );
});
