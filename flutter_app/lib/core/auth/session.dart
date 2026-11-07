/// 新用户身份与会话代次。
///
/// 全新注册体系：所有人重新注册，不继承旧 Auth UID、好友或权限。
/// [sessionGeneration] 用于本地数据分桶和旧请求拦截；登出、重注册、
/// 调课、时区变更、重启均需重新核对。
class AppUser {
  const AppUser({
    required this.uid,
    required this.phone,
    required this.nickname,
    required this.sessionGeneration,
    this.roles = const {},
  });

  /// 新系统用户 ID（非旧 CloudBase Auth UID）。
  final String uid;
  final String phone;
  final String nickname;
  final int sessionGeneration;
  final Set<String> roles;

  bool get isAdmin => roles.contains('admin') || roles.contains('owner');
  bool get isOwner => roles.contains('owner');

  AppUser copyWith({
    String? nickname,
    Set<String>? roles,
    int? sessionGeneration,
  }) {
    return AppUser(
      uid: uid,
      phone: phone,
      nickname: nickname ?? this.nickname,
      sessionGeneration: sessionGeneration ?? this.sessionGeneration,
      roles: roles ?? this.roles,
    );
  }

  Map<String, dynamic> toJson() => {
        'uid': uid,
        'phone': phone,
        'nickname': nickname,
        'sessionGeneration': sessionGeneration,
        'roles': roles.toList(),
      };

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
        uid: json['uid'] as String,
        phone: json['phone'] as String,
        nickname: json['nickname'] as String? ?? '',
        sessionGeneration: (json['sessionGeneration'] as num?)?.toInt() ?? 0,
        roles: ((json['roles'] as List?) ?? const []).map((e) => e.toString()).toSet(),
      );
}

enum AuthStatus {
  unauthenticated,
  authenticating,
  authenticated,
  authFailure,
}
