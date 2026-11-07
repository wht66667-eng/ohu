import 'package:dio/dio.dart';

/// 统一业务错误模型。HTTP 200 不等于业务成功；HTML 回退视为配置错误。
sealed class ApiError implements Exception {
  const ApiError(this.message);

  final String message;

  @override
  String toString() => 'ApiError: $message';
}

/// 网络层错误：超时、断网、DNS 失败等。
final class NetworkError extends ApiError {
  const NetworkError(super.message);
}

/// 网关返回非 JSON（如 HTML 错误页）：视为上游配置错误。
final class BadContentTypeError extends ApiError {
  const BadContentTypeError(super.message, this.contentType) : super();
  final String contentType;
}

/// 业务错误码。
final class BusinessError extends ApiError {
  const BusinessError(this.code, super.message, {this.raw});
  final int code;
  final Map<String, dynamic>? raw;
}

/// 鉴权失败：当前 token 失效或被撤销，需重新登录。
final class AuthError extends ApiError {
  const AuthError(super.message, {this.expired = false});
  final bool expired;
}

/// 未授权访问（403 业务越权）。
final class ForbiddenError extends ApiError {
  const ForbiddenError(super.message);
}

ApiError mapDioError(DioException e) {
  switch (e.type) {
    case DioExceptionType.connectionTimeout:
    case DioExceptionType.sendTimeout:
    case DioExceptionType.receiveTimeout:
      return NetworkError('网络超时，请稍后重试');
    case DioExceptionType.connectionError:
      return NetworkError('无法连接服务器，请检查网络');
    case DioExceptionType.badResponse:
      final status = e.response?.statusCode ?? 0;
      final data = e.response?.data;
      if (data is String && data.trimLeft().startsWith('<')) {
        return BadContentTypeError(
          '上游返回 HTML，疑似网关配置错误',
          e.response?.headers.value('content-type') ?? 'text/html',
        );
      }
      if (status == 401) return AuthError('登录已过期，请重新登录', expired: true);
      if (status == 403) return ForbiddenError('没有权限执行该操作');
      if (data is Map<String, dynamic>) {
        final code = (data['code'] as num?)?.toInt() ?? status;
        final msg = (data['message'] as String?) ?? '请求失败';
        return BusinessError(code, msg, raw: data);
      }
      return BusinessError(status, '请求失败（$status）');
    case DioExceptionType.cancel:
      return NetworkError('请求已取消');
    case DioExceptionType.badCertificate:
      return NetworkError('证书校验失败');
    case DioExceptionType.unknown:
    case DioExceptionType.transformTimeout:
      return NetworkError('未知网络错误');
  }
}
