import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';

import 'app/app.dart';
import 'app/providers.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Hive.initFlutter();

  final container = ProviderContainer();
  // 启动时恢复会话
  container.read(authControllerProvider);

  runApp(UncontrolledProviderScope(container: container, child: const OhuApp()));
}
