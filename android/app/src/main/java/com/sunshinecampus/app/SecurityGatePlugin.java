package com.sunshinecampus.app;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** freeRASP 的运行时告警进入原生阻断页，避免只显示可忽略的提示。 */
@CapacitorPlugin(name = "SecurityGate")
public final class SecurityGatePlugin extends Plugin {
    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("debuggable", (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        call.resolve(result);
    }

    @PluginMethod
    public void block(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Intent intent = new Intent(getActivity(), SecurityBlockedActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            getActivity().startActivity(intent);
            getActivity().finish();
        });
        call.resolve();
    }
}
