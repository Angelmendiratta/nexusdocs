/// <reference types="node" />
export default {
  port: Number(process.env.PORT || 8090),

  dataDir: './pb_data',

  database: {
    type: 'postgres',
    url: process.env.DATABASE_URL,
  },

  auth: {
    providers: ['email'],
  },

  rateLimiting: {
    enabled: true,
  },

  ai: {
    enabled: false,
  },
};