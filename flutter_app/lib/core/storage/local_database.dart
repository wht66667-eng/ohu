import 'package:hive_flutter/hive_flutter.dart';

/// 本地数据库：按用户 UID 和会话代次分桶，A/B 切换无串号，退出后旧请求不回写。
///
/// 盒子命名：`ohu:<uid>:<generation>`，切换账号或会话代次时旧盒子不再打开，
/// 并在清理时删除。不把旧账号的缓存暴露给新账号。
class LocalDatabase {
  LocalDatabase({required this.uid, required this.generation});

  final String uid;
  final int generation;

  static const _prefix = 'ohu';

  String get _boxName => '$_prefix:$uid:$generation';

  late final Box _box;

  Future<void> open() async {
    _box = await Hive.openBox(_boxName);
  }

  Future<void> close() => _box.close();

  Future<void> put(String key, dynamic value) => _box.put(key, value);
  dynamic get(String key) => _box.get(key);
  Future<void> delete(String key) => _box.delete(key);

  /// 删除当前用户的指定代次盒子；注销账号时由调用方传入需清理的代次列表。
  static Future<void> deleteUserBuckets(String uid, List<int> generations) async {
    for (final gen in generations) {
      final name = '$_prefix:$uid:$gen';
      if (Hive.isBoxOpen(name)) {
        await Hive.box(name).close();
      }
      await Hive.deleteBoxFromDisk(name);
    }
  }
}
