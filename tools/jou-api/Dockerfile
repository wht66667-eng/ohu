# 江苏海洋大学课表抓取服务（Flask + gunicorn）
#
# 本地构建运行：
#   docker build -t jou-api .
#   docker run --rm -p 8090:8090 -e MOCK=1 jou-api
#
# 云托管（CloudRun）源码构建：targetPath 指向本目录，serverConfig.Port = 8090
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TZ=Asia/Shanghai \
    PORT=8090

WORKDIR /app

# 依赖单独一层，利用构建缓存（只要 requirements.txt 不变就无需重装）
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py request_security.py jou_client.py academic_parse.py captcha_ocr.py chaoxing_read.py physical_read.py THIRD_PARTY_NOTICES.md ./

# 非 root 运行
RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import os,urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8090')+'/api/health',timeout=4).status==200 else 1)"

# ⚠️ 必须单 worker：验证码会话保存在进程内存中，「取验证码 → 提交查询」两次请求
#    必须命中同一进程，多 worker 会表现为"验证码错误/会话过期"(1001)。
#    并发由应用内的信号量闸门（MAX_UPSTREAM_CONCURRENCY）控制，线程数给足即可。
CMD ["sh", "-c", "exec gunicorn -w 1 -k gthread --threads 16 --timeout 60 --graceful-timeout 30 --access-logfile - --error-logfile - -b 0.0.0.0:${PORT:-8090} app:app"]
