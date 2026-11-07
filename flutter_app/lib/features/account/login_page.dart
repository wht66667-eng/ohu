import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../core/auth/session.dart';

/// 登录/注册页：手机验证码 + 密码（全新用户体系）。
class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final _phoneCtrl = TextEditingController();
  final _pwdCtrl = TextEditingController();
  final _codeCtrl = TextEditingController();
  final _nickCtrl = TextEditingController();
  bool _isRegister = false;
  bool _obscure = true;
  int _countdown = 0;
  Timer? _timer;
  bool _sendingCode = false;

  @override
  void dispose() {
    _phoneCtrl.dispose();
    _pwdCtrl.dispose();
    _codeCtrl.dispose();
    _nickCtrl.dispose();
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final state = ref.watch(authControllerProvider);
    final loading = state.status == AuthStatus.authenticating;

    return Scaffold(
      appBar: AppBar(title: Text(_isRegister ? '注册' : '登录')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 24),
            Icon(Icons.pets, size: 72, color: scheme.primary),
            const SizedBox(height: 16),
            Text('哦狐', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.bold), textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Text('全新上线 · 校园学习生活助手', style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant), textAlign: TextAlign.center),
            const SizedBox(height: 40),
            TextField(
              controller: _phoneCtrl,
              keyboardType: TextInputType.phone,
              maxLength: 11,
              decoration: const InputDecoration(labelText: '手机号', prefixIcon: Icon(Icons.phone_outlined), counterText: ''),
            ),
            const SizedBox(height: 16),
            if (_isRegister) ...[
              TextField(
                controller: _nickCtrl,
                decoration: const InputDecoration(labelText: '昵称（选填）', prefixIcon: Icon(Icons.person_outline)),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _codeCtrl,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: InputDecoration(
                  labelText: '验证码',
                  prefixIcon: const Icon(Icons.sms_outlined),
                  counterText: '',
                  suffix: SizedBox(
                    width: 96,
                    child: TextButton(
                      onPressed: (loading || _sendingCode || _countdown > 0) ? null : _sendCode,
                      child: _sendingCode
                          ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                          : Text(_countdown > 0 ? '${_countdown}s 后重发' : '获取验证码'),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),
            ],
            TextField(
              controller: _pwdCtrl,
              obscureText: _obscure,
              decoration: InputDecoration(
                labelText: '密码',
                prefixIcon: const Icon(Icons.lock_outline),
                suffixIcon: IconButton(icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => _obscure = !_obscure)),
              ),
            ),
            if (state.error != null) ...[
              const SizedBox(height: 12),
              Text(state.error!, style: TextStyle(color: scheme.error, fontSize: 13)),
            ],
            const SizedBox(height: 24),
            FilledButton(
              onPressed: loading ? null : _submit,
              child: loading ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Text(_isRegister ? '注册并登录' : '登录'),
            ),
            const SizedBox(height: 16),
            TextButton(
              onPressed: () {
                ref.read(authControllerProvider.notifier); // 触发状态读取以清除错误
                setState(() {
                  _isRegister = !_isRegister;
                });
              },
              child: Text(_isRegister ? '已有账号？去登录' : '没有账号？去注册'),
            ),
            if (_isRegister)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text('开发模式：验证码固定为 123456', style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12), textAlign: TextAlign.center),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _sendCode() async {
    final phone = _phoneCtrl.text.trim();
    if (phone.isEmpty || phone.length < 11) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('请输入正确的手机号')));
      return;
    }
    setState(() => _sendingCode = true);
    try {
      await ref.read(authRepositoryProvider).sendPhoneCode(phone);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('验证码已发送（开发模式：123456）')));
      setState(() {
        _countdown = 60;
      });
      _timer = Timer.periodic(const Duration(seconds: 1), (t) {
        if (_countdown <= 1) {
          t.cancel();
          if (mounted) setState(() => _countdown = 0);
        } else {
          if (mounted) setState(() => _countdown--);
        }
      });
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('发送失败：$e')));
    } finally {
      if (mounted) setState(() => _sendingCode = false);
    }
  }

  Future<void> _submit() async {
    final phone = _phoneCtrl.text.trim();
    final pwd = _pwdCtrl.text;
    if (phone.isEmpty || pwd.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('请填写手机号和密码')));
      return;
    }
    final ctrl = ref.read(authControllerProvider.notifier);
    if (_isRegister) {
      await ctrl.register(phone: phone, code: _codeCtrl.text.trim(), password: pwd, nickname: _nickCtrl.text.trim().isEmpty ? null : _nickCtrl.text.trim());
    } else {
      await ctrl.login(phone: phone, password: pwd);
    }
    if (mounted && ref.read(authControllerProvider).status == AuthStatus.authenticated) {
      context.go('/home');
    }
  }
}
