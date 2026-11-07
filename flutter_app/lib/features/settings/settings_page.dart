import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../app/theme.dart';

/// 设置页：三版主题切换、亮暗色、通用设置。
/// 三套主题切换不丢数据，仅改变视觉 token。
class SettingsPage extends ConsumerWidget {
  const SettingsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModeProvider);
    final brightness = ref.watch(brightnessProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('设置')),
      body: ListView(
        children: [
          const _SectionTitle('界面版本'),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Column(
              children: [
                for (final mode in OhuThemeMode.values)
                  _ThemeOption(
                    mode: mode,
                    selected: themeMode == mode,
                    onTap: () => ref.read(themeModeProvider.notifier).state = mode,
                  ),
              ],
            ),
          ),
          const Divider(height: 1),
          const _SectionTitle('外观'),
          SwitchListTile(
            secondary: const Icon(Icons.dark_mode_outlined),
            title: const Text('深色模式'),
            value: brightness == Brightness.dark,
            onChanged: (v) => ref.read(brightnessProvider.notifier).state = v ? Brightness.dark : Brightness.light,
          ),
          const Divider(height: 1),
          const _SectionTitle('通用'),
          const ListTile(leading: Icon(Icons.notifications_outlined), title: Text('消息通知'), trailing: Icon(Icons.chevron_right)),
          const ListTile(leading: Icon(Icons.storage_outlined), title: Text('存储空间'), trailing: Icon(Icons.chevron_right)),
          const ListTile(leading: Icon(Icons.language), title: Text('语言'), subtitle: Text('简体中文'), trailing: Icon(Icons.chevron_right)),
          const Divider(height: 1),
          const _SectionTitle('关于'),
          const ListTile(leading: Icon(Icons.info_outline), title: Text('关于哦狐'), subtitle: Text('v0.1.0 · Flutter 全新架构')),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title);
  final String title;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
        child: Text(title, style: Theme.of(context).textTheme.titleSmall?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant, fontWeight: FontWeight.w600)),
      );
}

class _ThemeOption extends StatelessWidget {
  const _ThemeOption({required this.mode, required this.selected, required this.onTap});
  final OhuThemeMode mode;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final previewColors = switch (mode) {
      OhuThemeMode.classic => const [Color(0xFF16735B), Color(0xFFED9A48), Color(0xFFFAF7EF)],
      OhuThemeMode.microGreen => const [Color(0xFF07C160), Color(0xFFFFFFFF), Color(0xFFFFFFFF)],
      OhuThemeMode.simple => const [Color(0xFF252525), Color(0xFFF5F5F5), Color(0xFFF5F5F5)],
    };
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 56,
                height: 40,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(8),
                  gradient: LinearGradient(colors: previewColors, begin: Alignment.topLeft, end: Alignment.bottomRight),
                  border: Border.all(color: scheme.outlineVariant),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(mode.label, style: const TextStyle(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 2),
                    Text(mode.description, style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12)),
                  ],
                ),
              ),
              Icon(selected ? Icons.check_circle : Icons.radio_button_unchecked, color: selected ? scheme.primary : scheme.outline),
            ],
          ),
        ),
      ),
    );
  }
}
