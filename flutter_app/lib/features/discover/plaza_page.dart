import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../app/theme.dart';

/// 广场动态数据模型
class PlazaPost {
  const PlazaPost({
    required this.id,
    required this.author,
    required this.avatarColor,
    required this.time,
    required this.content,
    required this.category,
    this.likes = 0,
    this.comments = const [],
    this.liked = false,
    this.imagePlaceholder = false,
  });
  final String id;
  final String author;
  final Color avatarColor;
  final String time;
  final String content;
  final String category; // 动态 / 二手 / 互助 / 失物
  final int likes;
  final List<String> comments;
  final bool liked;
  final bool imagePlaceholder;

  PlazaPost copyWith({int? likes, bool? liked, List<String>? comments}) => PlazaPost(
        id: id,
        author: author,
        avatarColor: avatarColor,
        time: time,
        content: content,
        category: category,
        likes: likes ?? this.likes,
        comments: comments ?? this.comments,
        liked: liked ?? this.liked,
        imagePlaceholder: imagePlaceholder,
      );
}

/// 广场分类
enum PlazaTab { recommend, feed, secondHand, help, lostFound }

extension PlazaTabX on PlazaTab {
  String get label => switch (this) {
        PlazaTab.recommend => '推荐',
        PlazaTab.feed => '动态',
        PlazaTab.secondHand => '二手',
        PlazaTab.help => '互助',
        PlazaTab.lostFound => '失物',
      };
  // 匹配帖子 category，recommend 显示全部
  bool matches(String category) =>
      this == PlazaTab.recommend ||
      (this == PlazaTab.feed && category == '动态') ||
      (this == PlazaTab.secondHand && category == '二手') ||
      (this == PlazaTab.help && category == '互助') ||
      (this == PlazaTab.lostFound && category == '失物');
}

/// 广场帖子状态管理
class PlazaNotifier extends StateNotifier<List<PlazaPost>> {
  PlazaNotifier() : super(_seed());

  static List<PlazaPost> _seed() => const [
        PlazaPost(
          id: '1',
          author: '林同学',
          avatarColor: OhuBrand.foxOrange,
          time: '2小时前',
          content: '今天去图书馆自习，有没有一起的？可以互相监督～',
          category: '动态',
          likes: 12,
          comments: ['我也想去！', '几楼呀'],
          liked: false,
          imagePlaceholder: true,
        ),
        PlazaPost(
          id: '2',
          author: '闲置小铺',
          avatarColor: OhuBrand.forest,
          time: '5小时前',
          content: '出九成新高数教材，带笔记，15元自取。有意私信～',
          category: '二手',
          likes: 5,
          comments: ['还在吗？'],
          liked: false,
        ),
        PlazaPost(
          id: '3',
          author: '阿狐志愿者',
          avatarColor: Color(0xFF5B8DEF),
          time: '昨天',
          content: '有同学能帮忙代取一下东区快递吗？跑腿费 5 元，感谢！',
          category: '互助',
          likes: 3,
          comments: [],
          liked: false,
        ),
        PlazaPost(
          id: '4',
          author: '失物招领',
          avatarColor: OhuBrand.gold,
          time: '昨天',
          content: '在图书馆三楼捡到一个蓝色水杯，失主请到服务台认领。',
          category: '失物',
          likes: 8,
          comments: ['我的我的！'],
          liked: false,
        ),
      ];

  void toggleLike(String id) {
    state = [
      for (final p in state)
        if (p.id == id)
          p.copyWith(liked: !p.liked, likes: p.liked ? p.likes - 1 : p.likes + 1)
        else
          p,
    ];
  }

  void addComment(String id, String text) {
    if (text.trim().isEmpty) return;
    state = [
      for (final p in state)
        if (p.id == id) p.copyWith(comments: [...p.comments, text.trim()]) else p,
    ];
  }

  void addPost(PlazaPost post) => state = [post, ...state];
}

final plazaProvider = StateNotifierProvider<PlazaNotifier, List<PlazaPost>>((ref) => PlazaNotifier());

final plazaTabProvider = StateProvider<PlazaTab>((ref) => PlazaTab.recommend);

/// 广场页：动态流、二手、互助、失物，支持点赞、评论、发帖。
class PlazaPage extends ConsumerWidget {
  const PlazaPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tab = ref.watch(plazaTabProvider);
    final posts = ref.watch(plazaProvider).where((p) => tab.matches(p.category)).toList();
    return Scaffold(
      appBar: AppBar(
        title: const Text('广场'),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('搜索功能开发中'))),
          ),
        ],
      ),
      body: Column(
        children: [
          _PlazaTabs(current: tab),
          Expanded(
            child: posts.isEmpty
                ? const Center(child: Text('暂无内容', style: TextStyle(color: Colors.grey)))
                : ListView.builder(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    itemCount: posts.length,
                    itemBuilder: (_, i) => _PlazaCard(post: posts[i]),
                  ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showComposeSheet(context, ref),
        icon: const Icon(Icons.add),
        label: const Text('发帖'),
      ),
    );
  }

  void _showComposeSheet(BuildContext context, WidgetRef ref) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _ComposeSheet(onPublish: (content, category) {
        final post = PlazaPost(
          id: DateTime.now().millisecondsSinceEpoch.toString(),
          author: '我',
          avatarColor: OhuBrand.forest,
          time: '刚刚',
          content: content,
          category: category,
        );
        ref.read(plazaProvider.notifier).addPost(post);
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('发布成功')));
      }),
    );
  }
}

class _PlazaTabs extends ConsumerWidget {
  const _PlazaTabs({required this.current});
  final PlazaTab current;
  static const _tabs = PlazaTab.values;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      height: 44,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: _tabs.length,
        separatorBuilder: (_, _) => const SizedBox(width: 20),
        itemBuilder: (context, i) {
          final t = _tabs[i];
          final active = current == t;
          return Center(
            child: GestureDetector(
              onTap: () => ref.read(plazaTabProvider.notifier).state = t,
              child: Text(
                t.label,
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                  color: active ? scheme.primary : scheme.onSurfaceVariant,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _PlazaCard extends ConsumerWidget {
  const _PlazaCard({required this.post});
  final PlazaPost post;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(radius: 18, backgroundColor: post.avatarColor, child: Text(post.author.substring(0, 1), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(post.author, style: const TextStyle(fontWeight: FontWeight.w600)),
                    Text(post.time, style: const TextStyle(fontSize: 12, color: Colors.grey)),
                  ]),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                  decoration: BoxDecoration(color: scheme.primaryContainer, borderRadius: BorderRadius.circular(4)),
                  child: Text(post.category, style: TextStyle(color: scheme.onPrimaryContainer, fontSize: 11)),
                ),
                const SizedBox(width: 8),
                Icon(Icons.more_horiz, color: scheme.onSurfaceVariant),
              ],
            ),
            const SizedBox(height: 10),
            Text(post.content, style: const TextStyle(height: 1.5)),
            if (post.imagePlaceholder) ...[
              const SizedBox(height: 12),
              Container(height: 160, decoration: BoxDecoration(color: OhuBrand.mint, borderRadius: BorderRadius.circular(12)), child: const Center(child: Icon(Icons.photo_outlined, size: 40, color: OhuBrand.forest))),
            ],
            const SizedBox(height: 12),
            Row(children: [
              GestureDetector(
                onTap: () => ref.read(plazaProvider.notifier).toggleLike(post.id),
                child: Row(children: [
                  Icon(post.liked ? Icons.favorite : Icons.favorite_border, size: 18, color: post.liked ? Colors.red : scheme.onSurfaceVariant),
                  const SizedBox(width: 4),
                  Text('${post.likes}', style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13)),
                ]),
              ),
              const SizedBox(width: 20),
              GestureDetector(
                onTap: () => _showCommentSheet(context, ref),
                child: Row(children: [
                  Icon(Icons.chat_bubble_outline, size: 18, color: scheme.onSurfaceVariant),
                  const SizedBox(width: 4),
                  Text('${post.comments.length}', style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13)),
                ]),
              ),
              const Spacer(),
              Icon(Icons.share, size: 18, color: scheme.onSurfaceVariant),
            ]),
          ],
        ),
      ),
    );
  }

  void _showCommentSheet(BuildContext context, WidgetRef ref) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _CommentSheet(post: post),
    );
  }
}

class _CommentSheet extends ConsumerStatefulWidget {
  const _CommentSheet({required this.post});
  final PlazaPost post;
  @override
  ConsumerState<_CommentSheet> createState() => _CommentSheetState();
}

class _CommentSheetState extends ConsumerState<_CommentSheet> {
  final _ctrl = TextEditingController();
  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final comments = ref.watch(plazaProvider).firstWhere((p) => p.id == widget.post.id, orElse: () => widget.post).comments;
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        initialChildSize: 0.6,
        minChildSize: 0.3,
        expand: false,
        builder: (context, scroll) => Column(
          children: [
            const SizedBox(height: 12),
            Center(child: Container(width: 36, height: 4, decoration: BoxDecoration(color: scheme.outlineVariant, borderRadius: BorderRadius.circular(2)))),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text('评论 (${comments.length})', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
            ),
            Expanded(
              child: comments.isEmpty
                  ? const Center(child: Text('还没有评论，快来抢沙发～', style: TextStyle(color: Colors.grey)))
                  : ListView.builder(
                      controller: scroll,
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      itemCount: comments.length,
                      itemBuilder: (_, i) => Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const CircleAvatar(radius: 14, backgroundColor: OhuBrand.mint, child: Icon(Icons.person, size: 16, color: OhuBrand.forest)),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                decoration: BoxDecoration(color: scheme.surfaceContainerHighest.withValues(alpha: 0.3), borderRadius: BorderRadius.circular(12)),
                                child: Text(comments[i]),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              decoration: BoxDecoration(color: scheme.surface, border: Border(top: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.4)))),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _ctrl,
                      decoration: const InputDecoration(hintText: '写下你的评论...', border: OutlineInputBorder()),
                      onSubmitted: (v) => _send(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(onPressed: _send, child: const Text('发送')),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _send() {
    if (_ctrl.text.trim().isEmpty) return;
    ref.read(plazaProvider.notifier).addComment(widget.post.id, _ctrl.text);
    _ctrl.clear();
  }
}

class _ComposeSheet extends StatefulWidget {
  const _ComposeSheet({required this.onPublish});
  final void Function(String content, String category) onPublish;

  @override
  State<_ComposeSheet> createState() => _ComposeSheetState();
}

class _ComposeSheetState extends State<_ComposeSheet> {
  final _ctrl = TextEditingController();
  String _category = '动态';
  static const _cats = ['动态', '二手', '互助', '失物'];

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(child: Container(width: 36, height: 4, decoration: BoxDecoration(color: scheme.outlineVariant, borderRadius: BorderRadius.circular(2)))),
            const SizedBox(height: 16),
            Row(
              children: [
                Text('发布新帖', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
                const Spacer(),
                IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(context)),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              children: [
                for (final c in _cats)
                  ChoiceChip(
                    label: Text(c),
                    selected: _category == c,
                    onSelected: (_) => setState(() => _category = c),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _ctrl,
              maxLines: 5,
              decoration: const InputDecoration(hintText: '分享你的校园生活...', border: OutlineInputBorder()),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _ctrl.text.trim().isEmpty ? null : () => widget.onPublish(_ctrl.text, _category),
                child: const Text('发布'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
