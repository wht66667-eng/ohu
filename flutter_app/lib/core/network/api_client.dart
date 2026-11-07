import 'package:dio/dio.dart';
import 'package:logger/logger.dart';

import 'api_error.dart';

/// 统一 HTTP 客户端。
/// - 注入当前用户 token、追踪 ID、超时
/// - 拦截非 JSON 响应并映射为 [ApiError]
/// - 所有业务请求通过 [request] 走统一错误模型
class ApiClient {
  ApiClient({
    required this.baseUrl,
    required this.tokenProvider,
    Dio? dio,
    Logger? logger,
    this.connectTimeout = const Duration(seconds: 15),
    this.receiveTimeout = const Duration(seconds: 30),
  })  : _dio = dio ?? Dio(),
        _logger = logger ?? Logger() {
    _dio.options
      ..baseUrl = baseUrl
      ..connectTimeout = connectTimeout
      ..receiveTimeout = receiveTimeout
      ..headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      };
    _dio.interceptors.add(_AuthInterceptor(tokenProvider, nextTraceId));
    _dio.interceptors.add(_LoggingInterceptor(_logger));
  }

  final String baseUrl;
  final Future<String?> Function() tokenProvider;
  final Duration connectTimeout;
  final Duration receiveTimeout;

  final Dio _dio;
  final Logger _logger;
  int _traceId = 0;

  Dio get raw => _dio;

  String nextTraceId() => 't${DateTime.now().millisecondsSinceEpoch}-${++_traceId}';

  /// 发起请求并统一映射错误。
  Future<T> request<T>(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? query,
    Object? body,
    Map<String, String>? headers,
    required T Function(dynamic data) parse,
  }) async {
    try {
      final res = await _dio.request(
        path,
        queryParameters: query,
        data: body,
        options: Options(method: method, headers: headers),
      );
      final ct = res.headers.value('content-type') ?? '';
      if (!ct.contains('application/json') && res.data is! Map && res.data is! List) {
        throw BadContentTypeError('期望 JSON，实际 $ct', ct);
      }
      return parse(res.data);
    } on ApiError {
      rethrow;
    } on DioException catch (e) {
      throw mapDioError(e);
    }
  }

  void dispose() => _dio.close();
}

class _AuthInterceptor extends Interceptor {
  _AuthInterceptor(this.tokenProvider, this.traceIdProvider);
  final Future<String?> Function() tokenProvider;
  final String Function() traceIdProvider;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    options.headers['X-Trace-Id'] = traceIdProvider();
    final token = await tokenProvider();
    if (token != null && token.isNotEmpty) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }
}

class _LoggingInterceptor extends Interceptor {
  _LoggingInterceptor(this.logger);
  final Logger logger;

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    logger.d('${response.requestOptions.method} ${response.requestOptions.path} -> ${response.statusCode}');
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    logger.w('${err.requestOptions.method} ${err.requestOptions.path} failed: ${err.type}');
    handler.next(err);
  }
}
