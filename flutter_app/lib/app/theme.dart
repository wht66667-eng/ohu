import 'package:flutter/material.dart';

/// 三版界面：经典狐狸版（默认）、微绿版、简单版。
/// 配色沿用实际设计令牌：森林绿 #1f5b3a、象牙白 #fff8eb、狐狸橙 #ff8a3d。
enum OhuThemeMode {
  classic,
  microGreen,
  simple,
}

extension OhuThemeModeX on OhuThemeMode {
  String get label => switch (this) {
        OhuThemeMode.classic => '经典版',
        OhuThemeMode.microGreen => '微绿版',
        OhuThemeMode.simple => '简单版',
      };

  String get description => switch (this) {
        OhuThemeMode.classic => '森林绿 + 象牙白 + 狐狸橙，保留插画与品牌感',
        OhuThemeMode.microGreen => '纯白背景、绿色操作，突出功能与内容',
        OhuThemeMode.simple => '中性灰度，优先显示功能',
      };
}

/// 品牌配色令牌（经典版）。
class OhuBrand {
  static const forest = Color(0xFF1F5B3A); // 森林绿
  static const ivory = Color(0xFFFFF8EB); // 象牙白
  static const foxOrange = Color(0xFFFF8A3D); // 狐狸橙
  static const gold = Color(0xFFFFC10B); // 金色
  static const cream = Color(0xFFFAF3E0); // 浅奶油（卡片底）
  static const mint = Color(0xFFE8F3EC); // 薄荷绿（辅助底）
}

class OhuTheme {
  /// 经典狐狸版：森林绿主色 + 象牙白底 + 狐狸橙点缀。
  static ThemeData classic(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    const seed = OhuBrand.forest;
    final scheme = ColorScheme.fromSeed(seedColor: seed, brightness: brightness);
    return _base(scheme, radius: 16, radiusLg: 22, elevation: 0).copyWith(
      scaffoldBackgroundColor: isDark ? const Color(0xFF14201A) : OhuBrand.ivory,
      colorScheme: scheme.copyWith(
        primary: isDark ? const Color(0xFF8FC9A8) : OhuBrand.forest,
        secondary: OhuBrand.foxOrange,
        surface: isDark ? const Color(0xFF1C2A22) : Colors.white,
      ),
    );
  }

  /// 微绿版：纯白底 + 微信绿。
  static ThemeData microGreen(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    const seed = Color(0xFF07C160);
    final scheme = ColorScheme.fromSeed(seedColor: seed, brightness: brightness);
    return _base(scheme, radius: 10, radiusLg: 14, elevation: 0).copyWith(
      scaffoldBackgroundColor: isDark ? const Color(0xFF151515) : const Color(0xFFFFFFFF),
    );
  }

  /// 简单版：中性灰度。
  static ThemeData simple(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    const seed = Color(0xFF252525);
    final scheme = ColorScheme.fromSeed(seedColor: seed, brightness: brightness);
    return _base(scheme, radius: 10, radiusLg: 14, elevation: 0).copyWith(
      scaffoldBackgroundColor: isDark ? const Color(0xFF151515) : const Color(0xFFF5F5F5),
    );
  }

  static ThemeData _base(ColorScheme scheme, {required double radius, required double radiusLg, required double elevation}) {
    return ThemeData(
      colorScheme: scheme,
      useMaterial3: true,
      fontFamily: 'PingFang SC',
      appBarTheme: AppBarTheme(
        centerTitle: true,
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        scrolledUnderElevation: 0,
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: scheme.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusLg)),
        shadowColor: Colors.transparent,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(46),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radius)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(radius)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radius)),
      ),
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: scheme.surface,
        selectedItemColor: scheme.primary,
        unselectedItemColor: scheme.onSurfaceVariant,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
    );
  }

  static ThemeData of(OhuThemeMode mode, Brightness brightness) {
    return switch (mode) {
      OhuThemeMode.classic => classic(brightness),
      OhuThemeMode.microGreen => microGreen(brightness),
      OhuThemeMode.simple => simple(brightness),
    };
  }
}
