import 'package:flutter/material.dart';

/// 统一六类页面状态：加载、空内容、错误、权限不足、离线旧快照、刷新成功。
enum PageState {
  loading,
  empty,
  error,
  forbidden,
  offlineSnapshot,
  content,
}

class StateScaffold extends StatelessWidget {
  const StateScaffold({
    super.key,
    required this.state,
    required this.content,
    this.errorMessage,
    this.onRetry,
    this.emptyMessage,
  });

  final PageState state;
  final Widget content;
  final String? errorMessage;
  final VoidCallback? onRetry;
  final String? emptyMessage;

  @override
  Widget build(BuildContext context) {
    return switch (state) {
      PageState.loading => const Center(child: CircularProgressIndicator()),
      PageState.empty => _Message(
          icon: Icons.inbox_outlined,
          text: emptyMessage ?? '暂无内容',
        ),
      PageState.error => _Message(
          icon: Icons.error_outline,
          text: errorMessage ?? '加载失败',
          action: onRetry != null ? '重试' : null,
          onAction: onRetry,
        ),
      PageState.forbidden => const _Message(
          icon: Icons.lock_outline,
          text: '没有权限查看该内容',
        ),
      PageState.offlineSnapshot => Stack(
          children: [
            content,
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: Material(
                color: Theme.of(context).colorScheme.tertiaryContainer,
                child: const Padding(
                  padding: EdgeInsets.symmetric(vertical: 6, horizontal: 12),
                  child: Text('当前为离线旧快照，连接网络后刷新'),
                ),
              ),
            ),
          ],
        ),
      PageState.content => content,
    };
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.icon, required this.text, this.action, this.onAction});
  final IconData icon;
  final String text;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 56, color: Theme.of(context).colorScheme.onSurfaceVariant),
          const SizedBox(height: 12),
          Text(text, style: Theme.of(context).textTheme.bodyLarge),
          if (action != null) ...[
            const SizedBox(height: 16),
            FilledButton.tonal(onPressed: onAction, child: Text(action!)),
          ],
        ],
      ),
    );
  }
}
