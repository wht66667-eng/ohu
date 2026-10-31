package com.sunshinecampus.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

@CapacitorPlugin(name = "ReminderOverlay")
public class ReminderOverlayPlugin extends Plugin {
    @Override public void load() { dispatchOpen(getActivity().getIntent()); }
    @Override protected void handleOnNewIntent(Intent intent) { dispatchOpen(intent); }
    private void dispatchOpen(Intent intent) {
        if (intent == null || !intent.hasExtra(ReminderOverlayWindow.OPEN_ROUTE)) return;
        String owner = intent.getStringExtra(ReminderOverlayWindow.OPEN_OWNER);
        String route = ReminderOverlayStore.route(intent.getStringExtra(ReminderOverlayWindow.OPEN_ROUTE));
        boolean preview = intent.getBooleanExtra(ReminderOverlayWindow.OPEN_PREVIEW, false);
        intent.removeExtra(ReminderOverlayWindow.OPEN_ROUTE); intent.removeExtra(ReminderOverlayWindow.OPEN_OWNER); intent.removeExtra(ReminderOverlayWindow.OPEN_PREVIEW);
        if (owner == null || !owner.equals(ReminderOverlayStore.owner(getContext()))) return;
        JSObject event = new JSObject(); event.put("route", route); event.put("ownerUid", owner); event.put("preview", preview);
        notifyListeners("openReminder", event, true);
    }
    @PluginMethod public void getState(PluginCall call) { call.resolve(ReminderOverlayStore.state(getContext())); }
    @PluginMethod public void requestPermission(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            boolean opened = false;
            if (!ReminderOverlayStore.granted(getContext())) {
                try { getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()))); opened = true; }
                catch (ActivityNotFoundException | SecurityException failure) { ReminderOverlayStore.error(getContext(), "系统未提供桌面覆盖授权入口，请从应用设置查看"); }
            }
            JSObject result = ReminderOverlayStore.state(getContext()); result.put("openedSettings", opened); call.resolve(result);
        });
    }
    @PluginMethod public void setEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) { call.reject("missing enabled"); return; }
        try { call.resolve(ReminderOverlayStore.setEnabled(getContext(), enabled)); }
        catch (RuntimeException failure) { call.reject(failure.getMessage(), failure); }
    }
    @PluginMethod public void sync(PluginCall call) {
        try {
            if (call.getArray("items") == null) { call.reject("missing items"); return; }
            call.resolve(ReminderOverlayStore.sync(getContext(), call.getString("ownerUid"), call.getArray("items")));
        } catch (Exception failure) { call.reject(failure.getMessage(), failure); }
    }
    @PluginMethod public void clear(PluginCall call) {
        try { call.resolve(ReminderOverlayStore.clear(getContext(), call.getString("ownerUid"), Boolean.TRUE.equals(call.getBoolean("preserveEnabled", false)))); }
        catch (RuntimeException failure) { call.reject(failure.getMessage(), failure); }
    }
    @PluginMethod public void preview(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String reason = ReminderOverlayWindow.show(getContext().getApplicationContext(), "15 分钟后上高等数学", "14:00 · B 楼 302。手动预览，不播放声音或震动。", "/schedule", ReminderOverlayStore.owner(getContext()), true);
            JSObject result = new JSObject(); result.put("shown", reason == null); result.put("reason", reason == null ? JSONObject.NULL : reason); result.put("state", ReminderOverlayStore.state(getContext())); call.resolve(result);
        });
    }
}
