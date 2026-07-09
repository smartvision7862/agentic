// PM2 process definition for Content Agent OS.
// Usage on the server:  pm2 start ecosystem.config.cjs  &&  pm2 save
module.exports = {
  apps: [
    {
      name: "content-os",
      script: "server/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        // Real secrets come from the .env file on the server, not from here.
      },
    },
  ],
};
