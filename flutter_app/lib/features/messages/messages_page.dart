import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../app/theme.dart';

/// 好友申请数据模型
class FriendRequest {
  const FriendRequest({
    required this.id,
    required this.name,
    required this.avatarColor,
    required this.note,
    this.status = FriendRequestStatus.pending,
  });
  final String id;
  final String name;
  final Color avatarColor;
  final String note;
  final FriendRequestStatus status;

  FriendRequest copyWith({FriendRequestStatus? status}) => FriendRequest(
        id: id,
        name: name,
        avatarColor: avatarColor,
        note: note,
        status: status ?? this.status,
      );
}

enum FriendRequestStatus { pending, accepted, rejected }

class FriendRequestNotifier extends StateNotifier<List<FriendRequest>> {
  FriendRequestNotifier() : super(const [
    FriendRequest(id: '1', name: '小明', avatarColor: OhuBrand.foxOrange, note: '我是高数课同桌'),
    FriendRequest(id: '2', name: '社团学姐', avatarColor: OhuBrand.forest, note: '欢迎加入摄影社～'),
  ]);

  void accept(String id) {
    state = [for (final r in state) if (r.id == id) r.copyWith(status: FriendRequestStatus.accepted) else r];
  }

  void reject(String id) {
    state = [for (final r in state) if (r.id == id) r.copyWith(status: FriendRequestStatus.rejected) else r];
  }
}

final friendRequestProvider = StateNotifierProvider<FriendRequestNotifier, List<FriendRequest>>((ref) => FriendRequestNotifier());

/// 私信会话模型
class ChatSession {
  const ChatSession({required this.name, required this.lastMsg, required this.time, required this.unread, required this.avatarColor, this.messages = const []});
  final String name;
  final String lastMsg;
  final String time;
  final int unread;
  final Color avatarColor;
  final List<({String from, String text})> messages;
}

final chatListProvider = Provider<List<ChatSession>>((ref) => const [
      ChatSession(name: '小红', lastMsg: '明天一起去图书馆吗？', time: '10:32', unread: 2, avatarColor: OhuBrand.forest, messages: [(from: '小红', text: '在吗？'), (from: '小红', text: '明天一起去图书馆吗？')]),
      ChatSession(name: '高数学习群', lastMsg: '老师：下节课带课本', time: '昨天', unread: 0, avatarColor: Color(0xFF5B8DEF)),
      ChatSession(name: '社团通知群', lastMsg: '本周六活动取消', time: '昨天', unread: 0, avatarColor: OhuBrand.gold),
    ]);

/// 消息页：系统通知、好友申请、私信会话。
class MessagesPage extends ConsumerWidget {
  const MessagesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final requests = ref.watch(friendRequestProvider);
    final chats = ref.watch(chatListProvider);
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('消息')),
      body: ListView(
        children: [
          _SectionHeader(title: '系统通知'),
          _SystemNotice(
            icon: Icons.schedule,
            title: '课程提醒',
            subtitle: '高等数学 即将开始',
            time: '刚刚',
            badge: 1,
            onTap: () => _showNoticeDetail(context, '课程提醒', '高等数学 将在 17:40 开始，请提前到达教室。'),
          ),
          _SystemNotice(
            icon: Icons.event,
            title: '考试安排',
            subtitle: '期末考试时间表已更新',
            time: '今天 09:20',
            onTap: () => _showNoticeDetail(context, '考试安排', '期末考试时间表已更新，请登录教务系统查看具体科目与时间。'),
          ),
          const Divider(height: 1, indent: 16, endIndent: 16),
          _SectionHeader(title: '好友申请 (${requests.where((r) => r.status == FriendRequestStatus.pending).length})'),
          for (final r in requests)
            if (r.status != FriendRequestStatus.rejected)
              ListTile(
                leading: CircleAvatar(backgroundColor: r.avatarColor, child: Text(r.name.substring(0, 1), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
                title: Text('${r.name} 请求加你为好友'),
                subtitle: Text(r.note),
                trailing: r.status == FriendRequestStatus.accepted
                    ? Text('已同意', style: TextStyle(color: scheme.primary, fontSize: 13))
                    : Row(mainAxisSize: MainAxisSize.min, children: [
                        TextButton(onPressed: () => ref.read(friendRequestProvider.notifier).reject(r.id), child: const Text('拒绝')),
                        const SizedBox(width: 4),
                        FilledButton(
                          onPressed: () {
                            ref.read(friendRequestProvider.notifier).accept(r.id);
                            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('已同意 ${r.name} 的好友申请')));
                          },
                          child: const Text('同意'),
                        ),
                      ]),
              ),
          const Divider(height: 1, indent: 16, endIndent: 16),
          _SectionHeader(title: '私信'),
          for (final c in chats)
            _ChatRow(
              chat: c,
              onTap: () => _openChat(context, c),
            ),
        ],
      ),
    );
  }

  void _showNoticeDetail(BuildContext context, String title, String content) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(title),
        content: Text(content),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('知道了'))],
      ),
    );
  }

  void _openChat(BuildContext context, ChatSession chat) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => ChatDetailPage(session: chat)));
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});
  final String title;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
        child: Text(title, style: Theme.of(context).textTheme.titleSmall?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant, fontWeight: FontWeight.w600)),
      );
}

class _SystemNotice extends StatelessWidget {
  const _SystemNotice({required this.icon, required this.title, required this.subtitle, required this.time, this.badge = 0, this.onTap});
  final IconData icon;
  final String title;
  final String subtitle;
  final String time;
  final int badge;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListTile(
      onTap: onTap,
      leading: CircleAvatar(backgroundColor: scheme.primaryContainer, child: Icon(icon, color: scheme.onPrimaryContainer, size: 20)),
      title: Text(title),
      subtitle: Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis),
      trailing: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.end, children: [
        Text(time, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
        if (badge > 0) ...[
          const SizedBox(height: 4),
          Container(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1), decoration: BoxDecoration(color: scheme.error, borderRadius: BorderRadius.circular(8)), child: Text('$badge', style: TextStyle(color: scheme.onError, fontSize: 11))),
        ],
      ]),
    );
  }
}

class _ChatRow extends StatelessWidget {
  const _ChatRow({required this.chat, required this.onTap});
  final ChatSession chat;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListTile(
      onTap: onTap,
      leading: CircleAvatar(backgroundColor: chat.avatarColor, child: Text(chat.name.substring(0, 1), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
      title: Text(chat.name, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(chat.lastMsg, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: scheme.onSurfaceVariant)),
      trailing: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.end, children: [
        Text(chat.time, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
        if (chat.unread > 0) ...[
          const SizedBox(height: 4),
          Container(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1), decoration: BoxDecoration(color: scheme.primary, borderRadius: BorderRadius.circular(8)), child: Text('${chat.unread}', style: TextStyle(color: scheme.onPrimary, fontSize: 11))),
        ],
      ]),
    );
  }
}

/// 私聊详情页
class ChatDetailPage extends StatefulWidget {
  const ChatDetailPage({super.key, required this.session});
  final ChatSession session;

  @override
  State<ChatDetailPage> createState() => _ChatDetailPageState();
}

class _ChatDetailPageState extends State<ChatDetailPage> {
  final _ctrl = TextEditingController();
  final List<({String from, String text})> _messages = [];

  @override
  void initState() {
    super.initState();
    _messages.addAll(widget.session.messages);
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: Text(widget.session.name)),
      body: Column(
        children: [
          Expanded(
            child: _messages.isEmpty
                ? const Center(child: Text('暂无消息', style: TextStyle(color: Colors.grey)))
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _messages.length,
                    itemBuilder: (_, i) {
                      final m = _messages[i];
                      final mine = m.from == '我';
                      return Align(
                        alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                        child: Container(
                          margin: const EdgeInsets.symmetric(vertical: 4),
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(
                            color: mine ? scheme.primary : scheme.surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(m.text, style: TextStyle(color: mine ? scheme.onPrimary : scheme.onSurfaceVariant)),
                        ),
                      );
                    },
                  ),
          ),
          Container(
            padding: EdgeInsets.fromLTRB(12, 8, 12, MediaQuery.of(context).viewInsets.bottom + 8),
            decoration: BoxDecoration(color: scheme.surface, border: Border(top: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.4)))),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _ctrl,
                    decoration: const InputDecoration(hintText: '输入消息...', border: OutlineInputBorder()),
                    onSubmitted: (_) => _send(),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(onPressed: _send, child: const Text('发送')),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _send() {
    if (_ctrl.text.trim().isEmpty) return;
    setState(() {
      _messages.add((from: '我', text: _ctrl.text.trim()));
    });
    _ctrl.clear();
  }
}
