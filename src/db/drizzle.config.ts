import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
config();
const { MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PWD, MYSQL_NAME } =
  process.env;
const DB_URL = `mysql://${MYSQL_USER}:${MYSQL_PWD}@${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_NAME}`;

export default defineConfig({
  schema: './packages/server/src/db/schema',
  out: './packages/server/src/db/migrations',
  dialect: 'mysql',

  dbCredentials: {
    url: DB_URL,
  },
});
