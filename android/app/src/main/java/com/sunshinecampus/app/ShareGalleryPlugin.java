package com.sunshinecampus.app;

import android.Manifest;
import android.content.ContentValues;
import android.content.ContentResolver;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.OutputStream;

@CapacitorPlugin(name = "ShareGallery", permissions = { @Permission(alias = "storage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }) })
public final class ShareGalleryPlugin extends Plugin {
    @PluginMethod public void save(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29 && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storageResult"); return;
        }
        write(call);
    }
    @PermissionCallback private void storageResult(PluginCall call) {
        if (getPermissionState("storage") != PermissionState.GRANTED) { call.reject("没有相册存储权限"); return; }
        write(call);
    }
    private void write(PluginCall call) {
        Uri uri = null;
        try {
            String data = call.getString("data", "");
            if (data.length() > 8000000 || !data.startsWith("data:image/png;base64,")) throw new Exception("图片格式不正确");
            byte[] bytes = Base64.decode(data.substring("data:image/png;base64,".length()), Base64.DEFAULT);
            byte[] magic = {(byte)137,80,78,71,13,10,26,10};
            if (bytes.length < magic.length || bytes.length > 6000000) throw new Exception("图片大小不正确");
            for (int i = 0; i < magic.length; i++) if (bytes[i] != magic[i]) throw new Exception("图片格式不正确");
            ContentResolver resolver = getContext().getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, "Ohhu-share-" + System.currentTimeMillis() + ".png");
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
            if (Build.VERSION.SDK_INT >= 29) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Ohhu");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
            }
            uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new Exception("无法创建相册图片");
            try (OutputStream out = resolver.openOutputStream(uri)) { if (out == null) throw new Exception("无法写入相册"); out.write(bytes); }
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues done = new ContentValues();
                done.put(MediaStore.Images.Media.IS_PENDING, 0);
                if (resolver.update(uri, done, null, null) < 1) throw new Exception("图片已写入但未能发布到相册");
            }
            call.resolve();
        } catch (Exception error) {
            if (uri != null) try { getContext().getContentResolver().delete(uri, null, null); } catch (Exception ignored) {}
            call.reject("保存到相册失败：" + error.getMessage());
        }
    }
}
