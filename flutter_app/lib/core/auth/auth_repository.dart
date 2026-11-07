import 'package:flutter/foundation.dart';

import '../network/api_client.dart';
import '../network/api_error.dart';
import '../storage/secure_token_store.dart';
import 'session.dart';

/// 认证仓库：手机验证码 + 密码注册/登录，会话恢复与退出。
///
/// 依赖 S1 新身份契约（同环境 Auth 重新注册、旧会话撤销、手机号重用）。
/// 在 S1-01 完成前，本类仅定义接口与本地会话管理，远程调用以 TODO 标注，
/// 不使用旧 Auth UID 作为新业务用户 ID。
abstract class AuthRepository {
  Future<AppUser?> restoreSession();
  Future<void> sendPhoneCode(String phone);
  Future<AppUser> register({required String phone, required String code, required String password, String? nickname});
  Future<AppUser> login({required String phone, required String password});
  Future<void> logout();
}

class AuthRepositoryImpl implements AuthRepository {
  AuthRepositoryImpl({
    required this.apiClient,
    required this.tokenStore,
  });

  final ApiClient apiClient;
  final SecureTokenStore tokenStore;

  @override
  Future<AppUser?> restoreSession() async {
    final stored = await tokenStore.read();
    if (stored == null) return null;
    // TODO(S1-01): 调用新身份校验接口，确认 token 仍有效且会话代次未被撤销。
    // 若失败则 clear 并返回 null。
    debugPrint('[auth] restored session uid=${stored.uid} gen=${stored.sessionGeneration}');
    return AppUser(
      uid: stored.uid,
      phone: '',
      nickname: '',
      sessionGeneration: stored.sessionGeneration,
    );
  }

  @override
  Future<void> sendPhoneCode(String phone) async {
    await apiClient.request(
      '/api/auth/send-code',
      method: 'POST',
      body: {'phone': phone},
      parse: (_) {},
    );
  }

  @override
  Future<AppUser> register({
    required String phone,
    required String code,
    required String password,
    String? nickname,
  }) async {
    // 注册接口必须保证并发/重复注册只有一个活跃主体。
    final data = await apiClient.request<Map<String, dynamic>>(
      '/api/auth/register',
      method: 'POST',
      body: {'phone': phone, 'code': code, 'password': password, 'nickname': nickname ?? ''},
      parse: (d) => Map<String, dynamic>.from(d as Map),
    );
    final userObj = Map<String, dynamic>.from((data['user'] as Map?) ?? const {});
    final uid = (userObj['id'] ?? data['uid']) as String;
    final token = data['token'] as String;
    const gen = 1;
    await tokenStore.save(uid: uid, token: token, sessionGeneration: gen);
    return AppUser(
      uid: uid,
      phone: phone,
      nickname: (userObj['nickname'] as String?) ?? '',
      sessionGeneration: gen,
      roles: ((userObj['roles'] as List?) ?? const []).map((e) => e.toString()).toSet(),
    );
  }

  @override
  Future<AppUser> login({required String phone, required String password}) async {
    final data = await apiClient.request<Map<String, dynamic>>(
      '/api/auth/login',
      method: 'POST',
      body: {'phone': phone, 'password': password},
      parse: (d) => Map<String, dynamic>.from(d as Map),
    );
    final userObj = Map<String, dynamic>.from((data['user'] as Map?) ?? const {});
    final uid = (userObj['id'] ?? data['uid']) as String;
    final token = data['token'] as String;
    const gen = 1;
    await tokenStore.save(uid: uid, token: token, sessionGeneration: gen);
    return AppUser(
      uid: uid,
      phone: phone,
      nickname: (userObj['nickname'] as String?) ?? '',
      sessionGeneration: gen,
      roles: ((userObj['roles'] as List?) ?? const []).map((e) => e.toString()).toSet(),
    );
  }

  @override
  Future<void> logout() async {
    try {
      await apiClient.request('/api/auth/logout', method: 'POST', parse: (_) {});
    } on ApiError {
      // 服务端撤销失败不阻塞本地清理。
    } finally {
      await tokenStore.clear();
    }
  }
}
