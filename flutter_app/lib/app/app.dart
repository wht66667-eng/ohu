import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'providers.dart';
import 'router.dart';
import 'theme.dart';

class OhuApp extends ConsumerWidget {
  const OhuApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModeProvider);
    final brightness = ref.watch(brightnessProvider);
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: '哦狐',
      debugShowCheckedModeBanner: false,
      theme: OhuTheme.of(themeMode, brightness),
      routerConfig: router,
    );
  }
}
