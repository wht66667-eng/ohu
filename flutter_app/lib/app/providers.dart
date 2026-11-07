import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/auth/auth_repository.dart';
import '../core/auth/session.dart';
import '../core/network/api_client.dart';
import '../core/storage/local_database.dart';
import '../core/storage/secure_token_store.dart';
import '../app/theme.dart';

// ---------- 基础设施 ----------

final sharedPreferencesProvider = Provider<SharedPreferences>((ref) {
  throw UnimplementedError('需在 main 中通过 override 注入');
});

final secureTokenStoreProvider = Provider<SecureTokenStore>((ref) {
  return SecureTokenStore();
});

/// 后端服务基址。新身份与业务接口均走此后端（CloudBase 云托管）。
const cloudBaseGateway =
    'https://ohu-server-296340-11-1394316826.sh.run.tcloudbase.com';

final apiClientProvider = Provider<ApiClient>((ref) {
  final tokenStore = ref.watch(secureTokenStoreProvider);
  return ApiClient(
    baseUrl: cloudBaseGateway,
    tokenProvider: () => tokenStore.readToken(),
  );
});

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepositoryImpl(
    apiClient: ref.watch(apiClientProvider),
    tokenStore: ref.watch(secureTokenStoreProvider),
  );
});

/// 本地数据库盒子，按当前用户与代次分桶。
final localDatabaseProvider = Provider<LocalDatabase?>((ref) {
  final state = ref.watch(authControllerProvider);
  final user = state.user;
  if (user == null) return null;
  final db = LocalDatabase(uid: user.uid, generation: user.sessionGeneration);
  ref.onDispose(db.close);
  // open 在 AuthController 登录成功后调用
  return db;
});

// ---------- 认证状态 ----------

class AuthState {
  const AuthState({this.user, this.status = AuthStatus.unauthenticated, this.error});
  final AppUser? user;
  final AuthStatus status;
  final String? error;

  AuthState copyWith({AppUser? user, AuthStatus? status, String? error, bool clearError = false}) {
    return AuthState(
      user: user ?? this.user,
      status: status ?? this.status,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

class AuthController extends StateNotifier<AuthState> {
  AuthController(this._repo) : super(const AuthState()) {
    _restore();
  }

  final AuthRepository _repo;

  Future<void> _restore() async {
    state = state.copyWith(status: AuthStatus.authenticating);
    final user = await _repo.restoreSession();
    if (user != null) {
      state = state.copyWith(user: user, status: AuthStatus.authenticated);
      _openLocalDb(user);
    } else {
      state = state.copyWith(status: AuthStatus.unauthenticated);
    }
  }

  Future<void> login({required String phone, required String password}) async {
    state = state.copyWith(status: AuthStatus.authenticating);
    try {
      final user = await _repo.login(phone: phone, password: password);
      state = state.copyWith(user: user, status: AuthStatus.authenticated, clearError: true);
      _openLocalDb(user);
    } catch (e) {
      state = state.copyWith(status: AuthStatus.authFailure, error: e.toString());
    }
  }

  Future<void> register({
    required String phone,
    required String code,
    required String password,
    String? nickname,
  }) async {
    state = state.copyWith(status: AuthStatus.authenticating);
    try {
      final user = await _repo.register(phone: phone, code: code, password: password, nickname: nickname);
      state = state.copyWith(user: user, status: AuthStatus.authenticated, clearError: true);
      _openLocalDb(user);
    } catch (e) {
      state = state.copyWith(status: AuthStatus.authFailure, error: e.toString());
    }
  }

  Future<void> logout() async {
    await _repo.logout();
    final user = state.user;
    if (user != null) {
      await LocalDatabase.deleteUserBuckets(user.uid, [user.sessionGeneration]);
    }
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  Future<void> _openLocalDb(AppUser user) async {
    await Hive.initFlutter();
    final db = LocalDatabase(uid: user.uid, generation: user.sessionGeneration);
    await db.open();
  }
}

final authControllerProvider =
    StateNotifierProvider<AuthController, AuthState>((ref) {
  return AuthController(ref.watch(authRepositoryProvider));
});

// ---------- 主题 ----------

final themeModeProvider = StateProvider<OhuThemeMode>((ref) => OhuThemeMode.microGreen);
final brightnessProvider = StateProvider<Brightness>((ref) => Brightness.light);
