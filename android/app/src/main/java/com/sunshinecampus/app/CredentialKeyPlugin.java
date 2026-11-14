package com.sunshinecampus.app;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.security.KeyStore;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 用 Android Keystore 包裹本机 Web 凭据密钥。
 * 仅在启动时交给受控 WebView；密钥不会以明文落盘。运行中已解锁设备仍需依靠壳完整性检查。
 */
@CapacitorPlugin(name = "CredentialKey")
public final class CredentialKeyPlugin extends Plugin {
    private static final String ALIAS = "ohu_credential_wrap_v1";
    private static final String PREFS = "ohu_credential_key_v1";
    private static final String WRAPPED = "wrapped";

    @PluginMethod
    public void getKey(PluginCall call) {
        try {
            byte[] key = readOrCreateKey();
            JSObject result = new JSObject();
            result.put("key", Base64.encodeToString(key, Base64.NO_WRAP));
            call.resolve(result);
        } catch (Exception e) {
            // 不能在密钥失效时静默生成新密钥，否则旧密码会无法恢复。
            call.reject("本机加密密钥不可用，请重新输入校园密码", "KEY_UNAVAILABLE");
        }
    }

    private synchronized byte[] readOrCreateKey() throws Exception {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
        String stored = prefs.getString(WRAPPED, null);
        SecretKey wrappingKey = wrappingKey();
        if (stored != null) {
            byte[] bytes = Base64.decode(stored, Base64.NO_WRAP);
            if (bytes.length < 13) throw new IllegalStateException("invalid wrapped key");
            byte[] nonce = new byte[12];
            byte[] ciphertext = new byte[bytes.length - 12];
            System.arraycopy(bytes, 0, nonce, 0, 12);
            System.arraycopy(bytes, 12, ciphertext, 0, ciphertext.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, wrappingKey, new GCMParameterSpec(128, nonce));
            byte[] plain = cipher.doFinal(ciphertext);
            if (plain.length != 32) throw new IllegalStateException("invalid key size");
            return plain;
        }

        byte[] fresh = new byte[32];
        new SecureRandom().nextBytes(fresh);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, wrappingKey);
        byte[] nonce = cipher.getIV();
        if (nonce.length != 12) throw new IllegalStateException("invalid nonce size");
        byte[] ciphertext = cipher.doFinal(fresh);
        byte[] combined = new byte[nonce.length + ciphertext.length];
        System.arraycopy(nonce, 0, combined, 0, nonce.length);
        System.arraycopy(ciphertext, 0, combined, nonce.length, ciphertext.length);
        if (!prefs.edit().putString(WRAPPED, Base64.encodeToString(combined, Base64.NO_WRAP)).commit()) {
            throw new IllegalStateException("key persistence failed");
        }
        return fresh;
    }

    private SecretKey wrappingKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }
}
