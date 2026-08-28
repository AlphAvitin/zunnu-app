const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const androidDir = path.join(root, 'android');
const sdkDir = 'C:/Users/windows/AppData/Local/Android/Sdk';

const candidates = [
  path.join(process.env.USERPROFILE || '', '.jdks', 'jbr-21.0.11'),
  process.env.JAVA_HOME,
  'C:/Program Files/Android/Android Studio/jbr'
].filter(Boolean);
const jdk = candidates.find(c => c && fs.existsSync(path.join(c, 'bin', 'java.exe')));
if (!jdk) { console.error('APK FAIL: JDK 17+ nao encontrado (procure em Android Studio jbr ou .jdks)'); process.exit(1); }

const gradlew = path.join(androidDir, 'gradlew.bat');
const r = spawnSync(gradlew, [':app:assembleDebug'], {
  cwd: androidDir,
  env: { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: sdkDir },
  stdio: 'inherit',
  shell: true
});
if (r.status !== 0) { console.error('APK FAIL: gradle exit code ' + r.status); process.exit(r.status || 1); }

const apk = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (!fs.existsSync(apk)) { console.error('APK FAIL: APK nao gerada em ' + apk); process.exit(1); }
console.log('APK OK: ' + apk + ' (' + (fs.statSync(apk).size / 1048576).toFixed(1) + ' MB)');