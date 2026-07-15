module.exports = {
  apps: [
    {
      name: 'wordflow',
      script: 'src/server.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      node_args: '--env-file-if-exists=.env',
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};

