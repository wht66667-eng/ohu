import 'package:flutter/material.dart';
import '../../app/theme.dart';

/// 狐狸头像占位组件（经典版使用狐狸形象）。
class FoxAvatar extends StatelessWidget {
  const FoxAvatar({super.key, this.size = 40, this.backgroundColor});
  final double size;
  final Color? backgroundColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: backgroundColor ?? OhuBrand.mint,
        shape: BoxShape.circle,
      ),
      child: Icon(Icons.pets, size: size * 0.5, color: OhuBrand.foxOrange),
    );
  }
}

/// 品牌横幅插画占位（首页顶部"和我狐一起探索更好的校园生活"）。
class BrandBanner extends StatelessWidget {
  const BrandBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFB8E0C8), Color(0xFFE8F3EC), Color(0xFFFFF0D6)],
        ),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('和我狐一起', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: OhuBrand.forest)),
                const Text('探索更好的', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: OhuBrand.forest)),
                const Text('校园生活！', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: OhuBrand.forest)),
                const SizedBox(height: 6),
                Text('学习 · 生活 · 朋友 · 成长', style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant)),
              ],
            ),
          ),
          Container(
            width: 80,
            height: 80,
            decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.5), shape: BoxShape.circle),
            child: const Icon(Icons.pets, size: 48, color: OhuBrand.foxOrange),
          ),
        ],
      ),
    );
  }
}
