module.exports = {
  apps: [
    {
      name: "vibefinance",
      script: "dist/index.js",
      cwd: "/opt/vibefinance/server",
      max_memory_restart: "300M",
      env: { NODE_ENV: "production" },
    },
  ],
};
