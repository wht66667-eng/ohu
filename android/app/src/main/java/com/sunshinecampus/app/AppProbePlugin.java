package com.sunshinecampus.app;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * App 安装探测：检测本机是否安装了能响应某 URL Scheme 的 App（京东/菜鸟/淘宝等）。
 * 用于快递查物流：已装则一键跳 App，未装则降级 H5。
 *
 * Android 11+ 需在 AndroidManifest.xml 的 <queries> 里声明对应 scheme，否则始终返回 false。
 */
@CapacitorPlugin(name = "AppProbe")
public class AppProbePlugin extends Plugin {

    /** Open only the known Perfect Campus launcher; no caller-supplied package. */
    @PluginMethod
    public void openPerfectCampus(PluginCall call) {
        JSObject ret = new JSObject();
        boolean ok = false;
        try {
            Intent launch = getContext().getPackageManager().getLaunchIntentForPackage("com.newcapec.mobile.ncp");
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(launch);
                ok = true;
            }
        } catch (RuntimeException ignored) { /* Fall back to the official page. */ }
        ret.put("ok", ok);
        call.resolve(ret);
    }

    /** Launch only the official Chaoxing Learning app when it is installed. */
    @PluginMethod
    public void openChaoxingApp(PluginCall call) {
        JSObject ret = new JSObject();
        boolean ok = false;
        try {
            Intent launch = getContext().getPackageManager().getLaunchIntentForPackage("com.chaoxing.mobile");
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(launch);
                ok = true;
            }
        } catch (RuntimeException ignored) { /* The web page provides an official fallback. */ }
        ret.put("ok", ok);
        call.resolve(ret);
    }

    /** Fixed QuickJump destinations; caller-supplied URL/component/extras are ignored. */
    @PluginMethod
    public void openExpressEntry(PluginCall call) {
        ExpressQuickJump.Result result = ExpressQuickJump.open(getContext(), call.getString("entryId", ""));
        JSObject ret = new JSObject();
        ret.put("ok", result.ok);
        ret.put("route", result.route);
        if (result.packageName != null) ret.put("packageName", result.packageName);
        call.resolve(ret);
    }

    @PluginMethod
    public void canOpenUrl(PluginCall call) {
        String url = call.getString("url", "");
        JSObject ret = new JSObject();
        if (url == null || url.isEmpty()) {
            ret.put("value", false);
            call.resolve(ret);
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            // MATCH_DEFAULT_ONLY：只匹配有 LAUNCHER Intent 的 App，避免命中无界面 Activity
            int resolved = getContext().getPackageManager()
                    .queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY).size();
            ret.put("value", resolved > 0);
        } catch (Throwable t) {
            ret.put("value", false);
        }
        call.resolve(ret);
    }

    /**
     * 原生唤起第三方 App（套壳内 WebView 的 iframe scheme 无效，必须走原生 startActivity）。
     * 成功打开返回 ok=true；App 未安装抛 ActivityNotFoundException，返回 ok=false 由前端降级 H5。
     */
    @PluginMethod
    public void launchUrl(PluginCall call) {
        String url = call.getString("url", "");
        JSObject ret = new JSObject();
        if (url == null || url.isEmpty()) {
            ret.put("ok", false);
            call.resolve(ret);
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            ret.put("ok", true);
        } catch (Throwable t) {
            ret.put("ok", false);
        }
        call.resolve(ret);
    }

    /**
     * 分享文本到微信（ACTION_SEND 拉起微信选择聊天）。学校电费、图书馆选座等页面是
     * 微信公众号 OAuth 网页，只能在微信内打开：发送到「文件传输助手」后点开链接即可。
     * 微信未安装或分享失败返回 ok=false，由前端降级为复制链接 + 拉起微信。
     */
    @PluginMethod
    public void shareToWeChat(PluginCall call) {
        String text = call.getString("text", "");
        JSObject ret = new JSObject();
        if (text == null || text.isEmpty()) {
            ret.put("ok", false);
            call.resolve(ret);
            return;
        }
        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, text);
            send.setPackage("com.tencent.mm");
            send.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(send);
            ret.put("ok", true);
        } catch (Throwable t) {
            ret.put("ok", false);
        }
        call.resolve(ret);
    }
}
