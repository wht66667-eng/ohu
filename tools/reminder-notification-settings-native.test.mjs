import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Execute the actual channel/diagnostics Java with inert OS services. These checks
// do not prove notification delivery on a phone and never play sound or vibrate.
const root = fileURLToPath(new URL('../', import.meta.url))
let scratch
before(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ohhu-notification-settings-'))
  const files = {
    'org/json/JSONObject.java': 'package org.json; public class JSONObject { public static final Object NULL=new Object(); }',
    'com/getcapacitor/JSObject.java': 'package com.getcapacitor; public class JSObject extends java.util.HashMap<String,Object> {}',
    'android/net/Uri.java': 'package android.net; public class Uri {private final String value;private Uri(String v){value=v;}public static Uri parse(String v){return new Uri(v);}public String toString(){return value;}}',
    'android/os/Build.java': 'package android.os; public class Build {public static class VERSION {public static int SDK_INT=35;}}',
    'android/os/PowerManager.java': 'package android.os; public class PowerManager {public boolean ignored=false;public boolean isIgnoringBatteryOptimizations(String pkg){return ignored;}}',
    'android/os/Vibrator.java': 'package android.os; public class Vibrator {public boolean present=true;public boolean hasVibrator(){return present;}}',
    'android/os/VibratorManager.java': 'package android.os; public class VibratorManager {public final Vibrator vibrator=new Vibrator();public Vibrator getDefaultVibrator(){return vibrator;}}',
    'android/media/AudioAttributes.java': 'package android.media; public class AudioAttributes {public static final int CONTENT_TYPE_SONIFICATION=4,USAGE_NOTIFICATION=5;public int content,usage;public static class Builder {final AudioAttributes value=new AudioAttributes();public Builder setContentType(int v){value.content=v;return this;}public Builder setUsage(int v){value.usage=v;return this;}public AudioAttributes build(){return value;}}}',
    'android/media/AudioManager.java': 'package android.media; public class AudioManager {public static final int RINGER_MODE_NORMAL=2,RINGER_MODE_VIBRATE=1,RINGER_MODE_SILENT=0,STREAM_NOTIFICATION=5;public int mode=2,volume=4,max=7;public boolean fail;public int getRingerMode(){if(fail)throw new SecurityException("restricted");return mode;}public int getStreamVolume(int stream){if(stream!=5)throw new AssertionError("wrong stream");return volume;}public int getStreamMaxVolume(int stream){return max;}}',
    'android/media/RingtoneManager.java': 'package android.media; public class RingtoneManager {public static final int TYPE_NOTIFICATION=2;public static android.net.Uri getDefaultUri(int type){if(type!=2)throw new AssertionError("wrong ringtone type");return android.net.Uri.parse("content://settings/system/notification_sound");}}',
    'android/app/AlarmManager.java': 'package android.app; public class AlarmManager {public boolean exact=true;public boolean canScheduleExactAlarms(){return exact;}}',
    'android/app/NotificationChannel.java': `package android.app; public class NotificationChannel {
      public final String id;public String name,description;public int importance,visibility;public boolean vibration;public long[] pattern;public int soundSetCalls;
      public android.net.Uri sound=android.net.Uri.parse("default://sound");public android.media.AudioAttributes attributes;
      public NotificationChannel(String id,String name,int importance){this.id=id;this.name=name;this.importance=importance;}
      public void setDescription(String d){description=d;}public void setLockscreenVisibility(int v){visibility=v;}
      public void enableVibration(boolean v){vibration=v;}public void setVibrationPattern(long[] p){pattern=p;}
      public void setSound(android.net.Uri s,android.media.AudioAttributes a){sound=s;attributes=a;soundSetCalls++;}
      public int getImportance(){return importance;}public android.net.Uri getSound(){return sound;}public boolean shouldVibrate(){return vibration;}
    }`,
    'android/app/NotificationManager.java': `package android.app; public class NotificationManager {
      public static final int INTERRUPTION_FILTER_ALL=1,INTERRUPTION_FILTER_PRIORITY=2,INTERRUPTION_FILTER_NONE=3,INTERRUPTION_FILTER_ALARMS=4;
      public final java.util.Map<String,NotificationChannel> channels=new java.util.HashMap<>();public int creates,filter=1;public boolean fail,discard;
      public NotificationChannel getNotificationChannel(String id){if(fail)throw new SecurityException("restricted");return channels.get(id);}
      public void createNotificationChannel(NotificationChannel c){creates++;if(!discard)channels.put(c.id,c);}
      public int getCurrentInterruptionFilter(){return filter;}
    }`,
    'android/content/Context.java': `package android.content; public class Context {
      public static final String NOTIFICATION_SERVICE="notification",ALARM_SERVICE="alarm",POWER_SERVICE="power",AUDIO_SERVICE="audio",VIBRATOR_SERVICE="vibrator",VIBRATOR_MANAGER_SERVICE="vibrators";
      public final java.util.Map<String,Object> services=new java.util.HashMap<>();public boolean notificationsEnabled=true,notificationReadFails;
      public Context(){services.put(NOTIFICATION_SERVICE,new android.app.NotificationManager());services.put(ALARM_SERVICE,new android.app.AlarmManager());services.put(POWER_SERVICE,new android.os.PowerManager());services.put(AUDIO_SERVICE,new android.media.AudioManager());services.put(VIBRATOR_SERVICE,new android.os.Vibrator());services.put(VIBRATOR_MANAGER_SERVICE,new android.os.VibratorManager());}
      public Object getSystemService(String name){return services.get(name);}public String getPackageName(){return "synthetic.app";}
    }`,
    'androidx/core/app/NotificationManagerCompat.java': 'package androidx.core.app; public class NotificationManagerCompat {final android.content.Context c;private NotificationManagerCompat(android.content.Context c){this.c=c;}public static NotificationManagerCompat from(android.content.Context c){return new NotificationManagerCompat(c);}public boolean areNotificationsEnabled(){if(c.notificationReadFails)throw new SecurityException("restricted");return c.notificationsEnabled;}}',
    'com/sunshinecampus/app/ReminderNotificationSettingsHarness.java': `package com.sunshinecampus.app;
      import android.content.Context;import android.app.NotificationManager;import android.app.NotificationChannel;import android.media.AudioManager;import android.os.Build;import com.getcapacitor.JSObject;import org.json.JSONObject;
      public class ReminderNotificationSettingsHarness {
        static void check(boolean b,String why){if(!b)throw new AssertionError(why);}
        static NotificationManager manager(Context c){return (NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);}
        static String id(boolean sound,boolean vibration){return "class-remind-important-s"+(sound?1:0)+"v"+(vibration?1:0)+"-v4";}
        static JSObject create(Context c,boolean sound,boolean vibration){return ReminderNotificationSettings.ensureChannel(c,id(sound,vibration),"Course reminders","Synthetic description",4,1,vibration,sound);}
        static void combinations(){Context c=new Context();for(boolean sound:new boolean[]{false,true})for(boolean vibration:new boolean[]{false,true}){
          JSObject r=create(c,sound,vibration);check(Boolean.TRUE.equals(r.get("supported"))&&Boolean.TRUE.equals(r.get("created")),"new channel not created");
          NotificationChannel n=manager(c).channels.get(id(sound,vibration));check(n!=null&&n.importance==4&&n.visibility==1,"wrong channel metadata");
          check(n.vibration==vibration,"vibration ignored");check(n.soundSetCalls==1,"sound was not explicitly set");check((n.sound!=null)==sound,"silent channel kept default sound");
          if(sound)check(n.sound.toString().equals("content://settings/system/notification_sound")&&n.attributes.usage==5&&n.attributes.content==4,"not system notification ringtone");
          if(vibration)check(java.util.Arrays.equals(n.pattern,new long[]{0,250,150,250}),"vibration pattern mismatch");else check(n.pattern==null,"silent channel has vibration pattern");
        }check(manager(c).creates==4,"unexpected channels");}
        static void preserve(){Context c=new Context();create(c,true,true);NotificationChannel n=manager(c).channels.get(id(true,true));n.importance=0;n.sound=null;n.vibration=false;n.name="User choice";int calls=n.soundSetCalls;
          JSObject r=create(c,true,true);check(Boolean.FALSE.equals(r.get("created")),"existing channel recreated");check(manager(c).creates==1&&n.soundSetCalls==calls&&n.sound==null&&!n.vibration&&n.importance==0&&n.name.equals("User choice"),"user preferences overwritten");}
        static void invalid(){Context c=new Context();String[] bad={null,"","exam-remind-important-s1v1-v4","class-remind-important-s1v1-v5","class-remind-important-s1v0-v4","x"};
          for(String id:bad){boolean rejected=false;try{ReminderNotificationSettings.ensureChannel(c,id,"Course","",4,1,true,true);}catch(IllegalArgumentException expected){rejected=true;}check(rejected,"invalid/mismatched channel accepted");}
          Object[][] badConfig={{"",4,1,true,true},{"Course",1,1,true,true},{"Course",5,1,true,true},{"Course",4,2,true,true},{"Course",2,1,true,true},{"Course",4,1,null,true},{"Course",4,1,true,null}};
          for(Object[] x:badConfig){boolean rejected=false;try{ReminderNotificationSettings.ensureChannel(c,id(true,true),(String)x[0],"",(Integer)x[1],(Integer)x[2],(Boolean)x[3],(Boolean)x[4]);}catch(IllegalArgumentException expected){rejected=true;}check(rejected,"invalid policy accepted");}
          check(manager(c).creates==0,"invalid request mutated channels");manager(c).discard=true;boolean failed=false;try{create(c,true,true);}catch(IllegalStateException expected){failed=true;}check(failed,"OS refusal reported as success");}
        static void diagnostics(){Context c=new Context();create(c,false,true);c.notificationsEnabled=false;((android.app.AlarmManager)c.getSystemService(Context.ALARM_SERVICE)).exact=false;((android.os.PowerManager)c.getSystemService(Context.POWER_SERVICE)).ignored=true;
          AudioManager a=(AudioManager)c.getSystemService(Context.AUDIO_SERVICE);a.mode=0;a.volume=0;manager(c).filter=3;
          JSObject r=ReminderNotificationSettings.state(c,id(false,true));check(Boolean.TRUE.equals(r.get("courseChannelsSupported")),"modern Android channel capability missing");check(Boolean.TRUE.equals(r.get("courseAlarmClockSupported")),"new course scheduling capability missing");check(Boolean.FALSE.equals(r.get("notificationsEnabled"))&&Boolean.FALSE.equals(r.get("exactAlarmAllowed")),"denied permission not read");
          check(Boolean.TRUE.equals(r.get("batteryOptimizationIgnored"))&&Boolean.TRUE.equals(r.get("hasVibrator")),"device capability mismatch");check(r.get("ringerMode").equals("silent")&&r.get("notificationVolume").equals(0)&&r.get("notificationMaxVolume").equals(7)&&r.get("interruptionFilter").equals("none"),"mute/DND not read");
          check(Boolean.TRUE.equals(r.get("channelExists"))&&r.get("channelImportance").equals(4)&&Boolean.FALSE.equals(r.get("channelSoundEnabled"))&&Boolean.TRUE.equals(r.get("channelVibrationEnabled")),"channel policy not read");
          check(manager(c).creates==1&&manager(c).filter==3&&a.mode==0&&a.volume==0,"diagnostic changed OS state");
          JSObject absent=ReminderNotificationSettings.state(c,"class-remind-missing");check(Boolean.FALSE.equals(absent.get("channelExists"))&&absent.get("channelSoundEnabled")==JSONObject.NULL,"missing channel fabricated");
          for(int i=0;i<3;i++){a.mode=i;manager(c).filter=i+1;r=ReminderNotificationSettings.state(c,"");check(r.get("ringerMode").equals(new String[]{"silent","vibrate","normal"}[i]),"ringer mapping wrong");}
          manager(c).filter=4;check(ReminderNotificationSettings.state(c,"").get("interruptionFilter").equals("alarms"),"alarms-only filter not mapped");
          manager(c).filter=99;check(ReminderNotificationSettings.state(c,"").get("interruptionFilter").equals("unknown"),"unknown filter fabricated");}
        static void unknown(){Context c=new Context();c.services.clear();c.notificationReadFails=true;JSObject r=ReminderNotificationSettings.state(c,"course");for(String k:new String[]{"notificationsEnabled","exactAlarmAllowed","batteryOptimizationIgnored","hasVibrator","notificationVolume","notificationMaxVolume","channelExists","channelImportance","channelSoundEnabled","channelVibrationEnabled"})check(r.get(k)==JSONObject.NULL,"unknown became true/false for "+k);check(r.get("ringerMode").equals("unknown")&&r.get("interruptionFilter").equals("unknown"),"unknown OS state fabricated");}
        static void oldApi(){Context c=new Context();Build.VERSION.SDK_INT=25;JSObject r=create(c,true,true);check(Boolean.FALSE.equals(r.get("supported"))&&Boolean.FALSE.equals(r.get("created"))&&manager(c).creates==0,"old API pretended channel available");
          ((android.os.Vibrator)c.getSystemService(Context.VIBRATOR_SERVICE)).present=false;r=ReminderNotificationSettings.state(c,id(true,true));check(Boolean.TRUE.equals(r.get("supported"))&&Boolean.FALSE.equals(r.get("courseChannelsSupported")),"bridge availability confused with channel support");check(Boolean.TRUE.equals(r.get("exactAlarmAllowed"))&&Boolean.FALSE.equals(r.get("hasVibrator"))&&r.get("channelExists")==JSONObject.NULL,"old API capabilities wrong");}
        public static void main(String[] args){switch(args[0]){case "combinations":combinations();break;case "preserve":preserve();break;case "invalid":invalid();break;case "diagnostics":diagnostics();break;case "unknown":unknown();break;case "old-api":oldApi();break;default:throw new AssertionError("unknown test");}System.out.println("passed "+args[0]);}
      }`,
  }
  const paths = []
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(scratch, name)
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); paths.push(target)
  }
  const actual = path.join(root, 'android/app/src/main/java/com/sunshinecampus/app/ReminderNotificationSettings.java')
  try { execFileSync('javac', ['-encoding', 'UTF-8', '-d', scratch, ...paths, actual], { stdio: 'pipe' }) }
  catch (error) { if (error.stderr) process.stderr.write(error.stderr); throw error }
})
after(() => {
  if (!scratch) return
  assert.ok(path.resolve(scratch).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(scratch).startsWith('ohhu-notification-settings-'))
  fs.rmSync(scratch, { recursive: true, force: true })
})
for (const [scenario, title] of [
  ['combinations', 'new course channels explicitly honor all four sound/vibration combinations'],
  ['preserve', 'existing course channels retain user sound, vibration and disabled preferences'],
  ['invalid', 'invalid or mismatched channels are rejected before mutation and OS refusal is reported'],
  ['diagnostics', 'read-only diagnostics report actual permission, channel, mute and DND states'],
  ['unknown', 'unavailable OS services remain unknown rather than fabricating granted access'],
  ['old-api', 'pre-channel Android reports unsupported combinations and its actual vibration capability'],
]) test(title, () => {
  const output = execFileSync('java', ['-cp', scratch, 'com.sunshinecampus.app.ReminderNotificationSettingsHarness', scenario], { encoding: 'utf8' })
  assert.match(output, new RegExp(`passed ${scenario}`))
})
