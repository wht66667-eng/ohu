# 原创合成哦狐提示音：纯标准库，无第三方音频素材。
# 用法: python tools/gen-sound-assets.py  ->  public/sounds/*.wav (22.05kHz mono 16-bit)
import math
import os
import random
import struct
import wave

SR = 22050
OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'public', 'sounds'))
random.seed(20261110)


def tone(freq, dur, tau, amp=1.0, harmonics=((1, 1.0),), glide=None, attack=0.004, vibrato=0.0):
    n = int(SR * dur)
    out = []
    for i in range(n):
        t = i / SR
        f = freq if glide is None else freq + (glide - freq) * min(1.0, t / 0.03)
        if vibrato:
            f *= 1 + vibrato * math.sin(2 * math.pi * 7 * t)
        phase = 2 * math.pi * f * t
        value = sum(weight * math.sin(phase * ratio) for ratio, weight in harmonics)
        env = min(1.0, t / attack) * math.exp(-t / tau)
        out.append(amp * env * value)
    return out


def breath_noise(dur, amp=1.0, alpha=0.02):
    """柔和呼吸：低通噪声 + 缓慢起伏包络。"""
    n = int(SR * dur)
    out, low = [], 0.0
    for i in range(n):
        t = i / SR
        low += alpha * (random.uniform(-1, 1) - low)
        env = math.sin(math.pi * min(1.0, t / dur)) ** 2
        out.append(amp * env * low * 3.0)
    return out


def mix(base, part, at):
    start = int(SR * at)
    need = start + len(part)
    if need > len(base):
        base.extend([0.0] * (need - len(base)))
    for i, v in enumerate(part):
        base[start + i] += v
    return base


def write(name, samples):
    peak = max((abs(v) for v in samples), default=0.0) or 1.0
    scale = 0.85 / peak
    frames = b''.join(struct.pack('<h', int(max(-1.0, min(1.0, v * scale)) * 32767)) for v in samples)
    path = os.path.join(OUT, name)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(frames)
    print(f'{name}: {len(samples) / SR:.2f}s, {os.path.getsize(path)} bytes')


def build():
    os.makedirs(OUT, exist_ok=True)
    # 按钮点击：轻柔木质敲击（短促下滑音 + 一点点敲击泛音）
    click = mix([], tone(980, 0.09, 0.016, 0.9, ((1, 1), (2.7, 0.18)), glide=720), 0)
    write('click.wav', click)
    # 页面切换：极轻柔和的气流声
    page = mix([], breath_noise(0.16, 0.5, 0.06), 0)
    page = mix(page, tone(520, 0.14, 0.05, 0.10), 0.01)
    write('page.wav', page)
    # 成功：清脆温暖的双音铃（E5 -> A5）
    success = mix([], tone(659.25, 0.34, 0.16, 0.8, ((1, 1), (2.76, 0.12))), 0)
    success = mix(success, tone(880.0, 0.4, 0.19, 0.8, ((1, 1), (2.76, 0.12))), 0.12)
    write('success.wav', success)
    # 任务完成：轻快上行三音（C5 E5 G5，马林巴质感）
    task = []
    for at, f in ((0, 523.25), (0.09, 659.25), (0.18, 783.99)):
        task = mix(task, tone(f, 0.3, 0.09, 0.75, ((1, 1), (4, 0.14))), at)
    write('task.wav', task)
    # 狐狸开心：可爱短促双音符，三个变体（不连续重复由播放器保证）
    for name, a, b in (('fox-happy-1.wav', 1318.5, 1568.0), ('fox-happy-2.wav', 783.99, 1174.7), ('fox-happy-3.wav', 880.0, 1318.5)):
        happy = mix([], tone(a, 0.1, 0.055, 0.7, ((1, 1), (3, 0.2)), glide=a * 1.06, vibrato=0.012), 0)
        happy = mix(happy, tone(b, 0.14, 0.07, 0.7, ((1, 1), (3, 0.2)), glide=b * 1.04, vibrato=0.012), 0.11)
        write(name, happy)
    # 狐狸入睡：柔和呼吸
    write('fox-sleep.wav', breath_noise(1.4, 0.5, 0.012))
    # 狐狸醒来：清脆铃声
    wake = mix([], tone(1046.5, 0.65, 0.24, 0.75, ((1, 1), (2.76, 0.1), (5.4, 0.05))), 0)
    write('fox-wake.wav', wake)
    # 通知：不刺耳的柔和下行双音
    notify = mix([], tone(783.99, 0.24, 0.13, 0.55), 0)
    notify = mix(notify, tone(659.25, 0.3, 0.15, 0.55), 0.13)
    write('notify.wav', notify)
    # 成就：仪式感和弦（C 大调分解进入 +  sustain）
    achieve = []
    for at, f in ((0, 261.63), (0.08, 329.63), (0.16, 392.0), (0.24, 523.25)):
        achieve = mix(achieve, tone(f, 1.05, 0.5, 0.4, ((1, 1), (2, 0.08)), attack=0.03), at)
    write('achieve.wav', achieve)


if __name__ == '__main__':
    build()