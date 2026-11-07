import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ohu/app/app.dart';
import 'package:ohu/core/auth/session.dart';

void main() {
  testWidgets('应用启动后展示底部主导航（首页/服务/发布/广场/我的）', (tester) async {
    await tester.pumpWidget(
      const ProviderScope(child: OhuApp()),
    );
    await tester.pumpAndSettle();

    // 底部主导航五项均可找到（首页同时出现在 AppBar 与子标签中，故用 findsWidgets）
    expect(find.text('首页'), findsWidgets);
    expect(find.text('服务'), findsWidgets);
    expect(find.text('发布'), findsOneWidget);
    expect(find.text('广场'), findsWidgets);
    expect(find.text('我的'), findsWidgets);
  });

  test('AppUser 角色判断正确', () {
    const owner = AppUser(
      uid: 'u1',
      phone: '13800000000',
      nickname: 'owner',
      sessionGeneration: 1,
      roles: {'owner'},
    );
    expect(owner.isOwner, isTrue);
    expect(owner.isAdmin, isTrue);

    const normal = AppUser(
      uid: 'u2',
      phone: '13800000001',
      nickname: 'u',
      sessionGeneration: 1,
    );
    expect(normal.isOwner, isFalse);
    expect(normal.isAdmin, isFalse);
  });
}
