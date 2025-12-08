import { schema } from './schema';
import { drizzle } from 'drizzle-orm/mysql2';
import * as mysql from 'mysql2/promise';
export const DBAsyncProvider = 'dbProvider';
import { config } from 'dotenv';

export const DBProvider = [
  {
    provide: DBAsyncProvider,
    useFactory: async () => {
      config();
      const { MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PWD, MYSQL_NAME } = process.env;
      const pool = await mysql.createPool({
        host: MYSQL_HOST,
        port: Number(MYSQL_PORT), // 포트를 숫자로 변환
        user: MYSQL_USER,
        password: MYSQL_PWD,
        database: MYSQL_NAME,
        timezone: 'Z', // UTC 시간대로 설정
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        keepAliveInitialDelay: 10000,
        enableKeepAlive: true,
      });
      const db = drizzle(pool, { schema, mode: 'default' });
      return db;
    },
    exports: [DBAsyncProvider],
  },
];
