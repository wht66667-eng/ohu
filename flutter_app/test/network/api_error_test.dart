import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ohu/core/network/api_error.dart';

void main() {
  group('mapDioError', () {
    test('超时映射为 NetworkError', () {
      final err = DioException(
        type: DioExceptionType.connectionTimeout,
        requestOptions: RequestOptions(path: '/x'),
      );
      expect(mapDioError(err), isA<NetworkError>());
    });

    test('401 映射为 AuthError 且 expired=true', () {
      final err = DioException(
        type: DioExceptionType.badResponse,
        requestOptions: RequestOptions(path: '/x'),
        response: Response(requestOptions: RequestOptions(path: '/x'), statusCode: 401),
      );
      final mapped = mapDioError(err);
      expect(mapped, isA<AuthError>());
      expect((mapped as AuthError).expired, isTrue);
    });

    test('HTML 响应映射为 BadContentTypeError', () {
      final err = DioException(
        type: DioExceptionType.badResponse,
        requestOptions: RequestOptions(path: '/x'),
        response: Response(
          requestOptions: RequestOptions(path: '/x'),
          statusCode: 500,
          data: '<html>error</html>',
          headers: Headers.fromMap({'content-type': ['text/html']}),
        ),
      );
      expect(mapDioError(err), isA<BadContentTypeError>());
    });
  });
}
