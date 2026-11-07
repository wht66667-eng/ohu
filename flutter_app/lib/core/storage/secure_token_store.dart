import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// 安全令牌存储：仅存放当前用户的访问令牌与刷新令牌。
/// 退出登录后必须清空，避免旧 token 回写。
class SecureTokenStore {
  SecureTokenStore({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  static const _keyToken = 'ohu.access_token';
  static const _keyUid = 'ohu.current_uid';
  static const _keySessionGen = 'ohu.session_generation';

  Future<void> save({
    required String uid,
    required String token,
    required int sessionGeneration,
  }) async {
    await _storage.write(key: _keyUid, value: uid);
    await _storage.write(key: _keyToken, value: token);
    await _storage.write(key: _keySessionGen, value: sessionGeneration.toString());
  }

  Future<({String uid, String token, int sessionGeneration})?> read() async {
    final uid = await _storage.read(key: _keyUid);
    final token = await _storage.read(key: _keyToken);
    final gen = await _storage.read(key: _keySessionGen);
    if (uid == null || token == null || gen == null) return null;
    return (uid: uid, token: token, sessionGeneration: int.tryParse(gen) ?? 0);
  }

  Future<String?> readToken() => _storage.read(key: _keyToken);

  Future<void> clear() async {
    await _storage.delete(key: _keyToken);
    await _storage.delete(key: _keyUid);
    await _storage.delete(key: _keySessionGen);
  }
}
