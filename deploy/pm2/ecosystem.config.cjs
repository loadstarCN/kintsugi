// PM2 ecosystem config for production.
//
// 设计要点：
//  - .env 固定在 /opt/kintsugi/.env（与 deploy 目录解耦），每次部署不重写。
//  - script 指向 /opt/kintsugi/server/dist/main.js（pnpm deploy --prod 产物）。
//  - 进程 cwd = /opt/kintsugi/server，prisma 等运行时拿到的相对路径正确。
//
// 首次部署后由 deploy 脚本调用 `pm2 startOrReload` 自动接管。
const fs = require('fs');

const ENV_FILE = '/opt/kintsugi/.env';
const env = {};
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) {
      let v = m[2];
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      env[m[1]] = v;
    }
  }
}

module.exports = {
  apps: [
    {
      name: 'kintsugi-server',
      script: '/opt/kintsugi/server/dist/main.js',
      cwd: '/opt/kintsugi/server',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '800M',
      kill_timeout: 8000,
      wait_ready: false,

      // 崩溃环保护：30s 内连崩 10 次就停手等人 —— 否则一行 typo 会被 pm2 永远重启
      // 直到 max_memory_restart 上限触发。
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 2000,

      // 日志：pm2-logrotate 由 server-bootstrap.sh 全局安装；这里给可读时间戳。
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      env,
    },
  ],
};
