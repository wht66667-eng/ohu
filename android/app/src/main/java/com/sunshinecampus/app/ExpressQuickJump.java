package com.sunshinecampus.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

/**
 * Fixed express destinations. Only an entry identifier crosses the JS bridge;
 * URLs, packages, intent components and extras are never supplied by callers.
 *
 * Destination references: https://github.com/chuhe0719/QuickJump at
 * df94cd7ab1cbca5171139259f63b44dc61cf8e9c. This launcher is independently
 * implemented; third-party pages and account login remain in the official apps.
 */
final class ExpressQuickJump {
    private static final String CAINIAO = "com.cainiao.wireless";
    private static final String TAOBAO = "com.taobao.taobao";
    private static final String PDD = "com.xunmeng.pinduoduo";
    private static final String DOUYIN = "com.ss.android.ugc.aweme";
    private static final String DOUYIN_LITE = "com.ss.android.ugc.aweme.lite";
    private static final String JD = "com.jingdong.app.mall";
    private static final String TAOBAO_CODE =
            "https://pages-fast.m.taobao.com/wow/z/uniapp/1011717/last-mile-fe/end-collect-platform/identity-code?x-ssr=true";
    private static final String TAOBAO_PENDING =
            "https://pages-fast.m.taobao.com/wow/z/uniapp/1100333/last-mile-fe/m-end-school-tab/home";
    private static final String PDD_WEB =
            "https://m.pinduoduo.net/mdkd/package?entry_source=18&extra_params=from_wx_jump%3D1&p_channel=0";

    static final class Result {
        final boolean ok;
        final String route;
        final String packageName;

        Result(boolean ok, String route, String packageName) {
            this.ok = ok;
            this.route = route;
            this.packageName = packageName;
        }
    }

    private static final class Candidate {
        final String packageName;
        final String url;
        final String route;

        Candidate(String packageName, String url, String route) {
            this.packageName = packageName;
            this.url = url;
            this.route = route;
        }
    }

    private static final class Entry {
        final String[] packages;
        final String webUrl;
        final Candidate[] candidates;

        Entry(String[] packages, String webUrl, Candidate... candidates) {
            this.packages = packages;
            this.webUrl = webUrl;
            this.candidates = candidates;
        }
    }

    private ExpressQuickJump() {}

    /**
     * Success means Android accepted one launch, not that the target app has
     * authenticated the user or displayed a particular screen. Stop on the first
     * accepted launch so a fallback cannot immediately cover that screen.
     */
    static Result open(Context context, String entryId) {
        Entry entry = entryFor(entryId);
        if (entry == null) return new Result(false, "unavailable", null);

        for (Candidate candidate : entry.candidates) {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(candidate.url));
            intent.setPackage(candidate.packageName);
            if (tryStart(context, intent)) {
                return new Result(true, candidate.route, candidate.packageName);
            }
        }
        for (String packageName : entry.packages) {
            try {
                Intent intent = context.getPackageManager().getLaunchIntentForPackage(packageName);
                if (intent == null) continue;
                intent.setPackage(packageName);
                if (tryStart(context, intent)) return new Result(true, "app", packageName);
            } catch (RuntimeException ignored) {
                // Missing/disabled/inaccessible apps must not prevent a web fallback.
            }
        }
        if (entry.webUrl != null) {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(entry.webUrl));
            if (tryStart(context, intent)) return new Result(true, "web", null);
        }
        return new Result(false, "unavailable", null);
    }

    private static boolean tryStart(Context context, Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(intent);
            return true;
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private static Candidate direct(String packageName, String url) {
        return new Candidate(packageName, url, "direct");
    }

    private static Candidate app(String packageName, String url) {
        return new Candidate(packageName, url, "app");
    }

    private static Entry entryFor(String entryId) {
        if (entryId == null) return null;
        switch (entryId) {
            case "cainiao-code":
                return new Entry(new String[] { CAINIAO },
                        "https://market.m.taobao.com/app/cn-yz/multi-activity/authCode.html?bizEntry=ALIPAY_GUOGUO",
                        direct(CAINIAO, "cainiao://desktop/station_code"),
                        app(CAINIAO, "cainiao://client.main"));
            case "taobao-code":
                return new Entry(new String[] { TAOBAO }, TAOBAO_CODE,
                        direct(TAOBAO, "taobao://m.taobao.com/tbopen/index.html?h5Url=https%3A%2F%2Fpages-fast.m.taobao.com%2Fwow%2Fz%2Funiapp%2F1011717%2Flast-mile-fe%2Fend-collect-platform%2Fidentity-code%3Fx-ssr%3Dtrue"),
                        direct(TAOBAO, "tbopen://m.taobao.com/tbopen/index.html?h5Url=https%3A%2F%2Fpages-fast.m.taobao.com%2Fwow%2Fz%2Funiapp%2F1011717%2Flast-mile-fe%2Fend-collect-platform%2Fidentity-code%3Fx-ssr%3Dtrue"));
            case "taobao-pending":
                return new Entry(new String[] { TAOBAO }, TAOBAO_PENDING,
                        direct(TAOBAO, "taobao://m.taobao.com/tbopen/index.html?h5Url=https%3A%2F%2Fpages-fast.m.taobao.com%2Fwow%2Fz%2Funiapp%2F1100333%2Flast-mile-fe%2Fm-end-school-tab%2Fhome"),
                        direct(TAOBAO, "tbopen://m.taobao.com/tbopen/index.html?h5Url=https%3A%2F%2Fpages-fast.m.taobao.com%2Fwow%2Fz%2Funiapp%2F1100333%2Flast-mile-fe%2Fm-end-school-tab%2Fhome"));
            case "pdd-code":
                return new Entry(new String[] { PDD }, PDD_WEB,
                        direct(PDD, "pinduoduo://com.xunmeng.pinduoduo/mdkd/package?tab=ID_CODE&entry_source=11&refer_page_name=login&refer_page_sn=10169"),
                        direct(PDD, "pinduoduo://com.xunmeng.pinduoduo/mdkd/package?tab=ID_CODE&entry_source=11"),
                        app(PDD, "pinduoduo://com.xunmeng.pinduoduo/mdkd/package"));
            case "pdd-pending":
                return new Entry(new String[] { PDD }, PDD_WEB,
                        direct(PDD, "pinduoduo://com.xunmeng.pinduoduo/mdkd/package"));
            case "douyin-orders":
                return new Entry(new String[] { DOUYIN, DOUYIN_LITE }, null,
                        direct(DOUYIN, "snssdk1128://ecom_order_list"),
                        app(DOUYIN, "snssdk1128://wallet"),
                        direct(DOUYIN_LITE, "snssdk2329://ecom_order_list"),
                        app(DOUYIN_LITE, "snssdk2329://wallet"));
            case "jd-orders":
                return new Entry(new String[] { JD }, "https://order.jd.com/center/list.action",
                        direct(JD, "openjd://virtual?params=%7B%22category%22%3A%22jump%22%2C%22des%22%3A%22orderlist%22%7D"));
            default:
                return null;
        }
    }
}
