import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { files as planFiles } from './review/reminder-plan-fixtures.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
function jsonJar(dir) {
  if (!fs.existsSync(dir)) return null
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, entry.name); if (entry.isDirectory()) { const found = jsonJar(p); if (found) return found } else if (/^json-.*\.jar$/.test(entry.name)) return p }
  return null
}
const json = jsonJar(path.join(os.homedir(), '.gradle/caches/modules-2/files-2.1/org.json/json'))
test('management upgrade revokes actual legacy timers, plans and guardian while preserving work notifications, account and schedule data', { skip: !json ? 'Existing Gradle JSON cache required' : false }, () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ohhu-admin-reminder-'))
  const files = { ...planFiles }
  for (const name of ['com/sunshinecampus/app/AdminShellReminderCleanup.java', 'com/sunshinecampus/app/ReminderPlanHarness.java', 'com/sunshinecampus/app/ReminderOverlayStore.java']) delete files[name]
  files['android/content/SharedPreferences.java'] = files['android/content/SharedPreferences.java'].replace('boolean commit();', 'boolean commit();default void apply(){commit();}')
  // Android JSONExceptions are checked; the desktop org.json cache makes them RuntimeExceptions.
  // Normalize that redundant catch only. Every scheduling/clear branch remains the production source.
  files['com/sunshinecampus/app/ReminderOverlayStore.java'] = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/sunshinecampus/app/ReminderOverlayStore.java'), 'utf8').replace('JSONException | RuntimeException', 'Exception')
  files['android/content/Context.java'] = files['android/content/Context.java'].replace('public boolean notificationsEnabled=true;', 'public int stoppedServices=0,startedServices=0;public boolean stopService(Intent i){stoppedServices++;return true;}public Context getApplicationContext(){return this;}public boolean notificationsEnabled=true;')
  files['android/content/Intent.java'] = files['android/content/Intent.java'].replace('private String action;', 'private String action;private final java.util.Map<String,Object> extra=new java.util.HashMap<>();').replace('ACTION_BOOT_COMPLETED="boot",', 'ACTION_LOCKED_BOOT_COMPLETED="locked",ACTION_BOOT_COMPLETED="boot",').replace('public String getAction()', 'public Intent putExtra(String key,int value){extra.put(key,value);return this;}public Intent putExtra(String key,long value){extra.put(key,value);return this;}public Intent putExtra(String key,String value){extra.put(key,value);return this;}public String getStringExtra(String key){return (String)extra.get(key);}public int getIntExtra(String key,int fallback){return extra.containsKey(key)?(Integer)extra.get(key):fallback;}public long getLongExtra(String key,long fallback){return extra.containsKey(key)?(Long)extra.get(key):fallback;}public String getAction()')
  files['android/net/Uri.java'] = 'package android.net; public class Uri {public String value;public static Uri parse(String s){Uri u=new Uri();u.value=s;return u;}public static class Builder {String value="";public Builder scheme(String s){value=s+":";return this;}public Builder authority(String s){value+="//"+s;return this;}public Builder appendPath(String s){value+="/"+s;return this;}public Uri build(){return parse(value);}}}'
  files['android/provider/Settings.java'] = 'package android.provider;public class Settings {public static boolean canDrawOverlays(android.content.Context c){return true;}}'
  files['android/util/Log.java'] = 'package android.util;public class Log {public static int w(String tag,String message,Throwable error){throw new AssertionError(message,error);}}'
  files['android/app/Notification.java'] = 'package android.app;public class Notification {String channel;public Notification(String channel){this.channel=channel;}public String getChannelId(){return channel;}}'
  files['android/service/notification/StatusBarNotification.java'] = 'package android.service.notification;public class StatusBarNotification {int id;String channel;public StatusBarNotification(int id,String channel){this.id=id;this.channel=channel;}public int getId(){return id;}public String getTag(){return null;}public android.app.Notification getNotification(){return new android.app.Notification(channel);}}'
  files['android/app/NotificationManager.java'] = 'package android.app;public class NotificationManager {public final NotificationChannel channel=new NotificationChannel();public final java.util.Map<Integer,String> active=new java.util.HashMap<>();public NotificationChannel getNotificationChannel(String id){return channel;}public void cancel(int id){active.remove(id);}public void cancel(String tag,int id){cancel(id);}public android.service.notification.StatusBarNotification[] getActiveNotifications(){return active.entrySet().stream().map(e->new android.service.notification.StatusBarNotification(e.getKey(),e.getValue())).toArray(android.service.notification.StatusBarNotification[]::new);}}'
  files['androidx/core/content/ContextCompat.java'] = 'package androidx.core.content;public class ContextCompat {public static void startForegroundService(android.content.Context c,android.content.Intent i){c.startedServices++;}}'
  files['com/sunshinecampus/app/BuildConfig.java'] = 'package com.sunshinecampus.app;public class BuildConfig {public static String SC_SHELL="admin";}'
  files['com/sunshinecampus/app/KeepAliveService.java'] = 'package com.sunshinecampus.app;import android.content.Context;public class KeepAliveService {static final String EXTRA_RESTORE_ONLY_IF_WANTED="restoreOnlyIfWanted";static boolean running=true;static boolean canPostNotifications(Context c){return true;}static void cancelStandalone(Context c){c.notifications.cancel(70502);}}'
  files['android/content/Intent.java'] = files['android/content/Intent.java'].replace('public Intent putExtra(String key,int value)', 'public Intent putExtra(String key,boolean value){extra.put(key,value);return this;}public Intent putExtra(String key,int value)')
  files['com/sunshinecampus/app/ReminderOverlayWindow.java'] = 'package com.sunshinecampus.app;public class ReminderOverlayWindow {static int dismissed=0,shown=0;static void dismiss(){dismissed++;}static void show(android.content.Context c,String t,String b,String r,String o,boolean keep){shown++;}}'
  files['com/sunshinecampus/app/AdminUpgradeHarness.java'] = `package com.sunshinecampus.app;
    import android.content.*;import android.app.PendingIntent;import org.json.*;import com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher;
    public class AdminUpgradeHarness {
      static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
      static JSONObject note(int id,String type){return new JSONObject().put("id",id).put("extra",new JSONObject().put("type",type).put("ownerUid","A"));}
      static void seed(Context c)throws Exception{
        c.getSharedPreferences("account",0).edit().putString("uid","A").commit();c.getSharedPreferences("schedule-cache",0).edit().putString("rows","preserved course data").commit();
        c.getSharedPreferences("reminder.boot.v1",0).edit().putString("ownerUid","A").putBoolean("enabled",true).commit();
        c.getSharedPreferences(KeepAliveBootReceiver.PREFS,0).edit().putBoolean(KeepAliveBootReceiver.KEY_WANTED,true).commit();
        c.getSharedPreferences("reminder.course-plan.v1",0).edit().putString("ownerUid","A").putString("source","[]").commit();
        ReminderOverlayStore.sync(c,"A",new JSONArray().put(new JSONObject().put("id",43000).put("at",System.currentTimeMillis()+60000).put("title","legacy").put("body","course").put("route","/schedule")));ReminderOverlayStore.setEnabled(c,true);
        for(int id:new int[]{40999,43000,51000,52000,60000,70011,68000,41003,90000}){
          String type=id==68000||id==41003?"admin-work":id==90000?"other":id==70011?"self-test":"";
          c.notices.put(String.valueOf(id),note(id,type));PendingIntent.getBroadcast(c,id,new Intent(c,TimedNotificationPublisher.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_MUTABLE);c.notifications.active.put(id,type.equals("admin-work")?"admin-work-v1":"legacy");
        }
        c.notifications.active.put(44004,"class-remind-v2");c.notifications.active.put(70501,"keep-alive-v1");c.notifications.active.put(70502,"keep-alive-v1");
      }
      public static void main(String[] args)throws Exception {
        Context c=new Context();seed(c);int before=c.alarms.armed;check(AdminShellReminderCleanup.enforce(c),"admin gate did not deny student entry");
        check(c.notices.size()==3&&c.notices.containsKey("68000")&&c.notices.containsKey("41003")&&c.notices.containsKey("90000"),"work/other notices lost or student notices retained");check(PendingIntent.activeNotificationCount(c)==3,"legacy personal timers remain");
        check(c.notifications.active.size()==3&&c.notifications.active.containsKey(41003),"delivered personal/guardian retained or admin ID collision removed");
        check(ReminderPlanStore.owner(c).isEmpty()&&ReminderOverlayStore.owner(c).isEmpty()&&!ReminderOverlayStore.enabled(c),"legacy native source/overlay not cleared");
        check(c.getSharedPreferences("reminder.boot.v1",0).getString("ownerUid","").isEmpty()&&!c.getSharedPreferences("reminder.boot.v1",0).getBoolean("enabled",true),"student boot recovery retained");
        check(!c.getSharedPreferences(KeepAliveBootReceiver.PREFS,0).getBoolean(KeepAliveBootReceiver.KEY_WANTED,true)&&c.stoppedServices>0&&!KeepAliveService.running,"legacy guardian retained");
        check(c.getSharedPreferences("account",0).getString("uid","").equals("A")&&c.getSharedPreferences("schedule-cache",0).getString("rows","").equals("preserved course data"),"account/course data destroyed");
        new KeepAliveBootReceiver().onReceive(c,new Intent(Intent.ACTION_MY_PACKAGE_REPLACED));new ReminderPlanReceiver().onReceive(c,new Intent(Intent.ACTION_BOOT_COMPLETED));new ReminderOverlayReceiver().onReceive(c,new Intent(Intent.ACTION_TIME_CHANGED));
        check(c.startedServices==0&&c.alarms.armed==before&&ReminderOverlayWindow.shown==0,"management restore revived student service/timer/overlay");
        AdminShellReminderCleanup.enforce(c);check(c.notices.size()==3,"repeat cleanup is destructive");
        BuildConfig.SC_SHELL="user";Context user=new Context();seed(user);check(!AdminShellReminderCleanup.enforce(user)&&user.notices.size()==9&&user.stoppedServices==0,"student shell plan changed");
        System.out.println("PASS actual management upgrade cleanup, repeat startup, receiver fences and student preservation");
      }
    }`
  try {
    for (const [name, source] of Object.entries(files)) { const target = path.join(scratch, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source) }
    const actual = ['AdminShellReminderCleanup.java', 'ReminderPlanStore.java', 'ReminderPlanReceiver.java', 'ReminderOverlayReceiver.java', 'KeepAliveBootReceiver.java'].map((name) => path.join(root, 'android/app/src/main/java/com/sunshinecampus/app', name))
    for (const name of ['CourseReminderPolicy.java', 'StudentReminderPolicy.java']) actual.push(path.join(root, 'node_modules/@capacitor/local-notifications/android/src/main/java/com/capacitorjs/plugins/localnotifications', name))
    const classes = path.join(scratch, 'classes'); fs.mkdirSync(classes)
    execFileSync('javac', ['-encoding', 'UTF-8', '-classpath', json, '-d', classes, ...Object.keys(files).map((name) => path.join(scratch, name)), ...actual], { stdio: 'pipe' })
    const output = execFileSync('java', ['-cp', `${classes}${path.delimiter}${json}`, 'com.sunshinecampus.app.AdminUpgradeHarness'], { encoding: 'utf8', stdio: 'pipe' })
    assert.match(output, /PASS actual management upgrade cleanup/); process.stdout.write(output)
  } catch (error) { if (error.stderr) process.stderr.write(error.stderr); throw error }
  finally { assert.ok(path.resolve(scratch).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(scratch).startsWith('ohhu-admin-reminder-')); fs.rmSync(scratch, { recursive: true, force: true }) }
})
