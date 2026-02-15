import { readFileSync } from 'fs';
import { join } from 'path';

export default () => ({
  port: parseInt(process.env.SERVER_PORT, 10) || 3001,
  jwt: {
    privateKey: readFileSync(
      join(process.cwd(), process.env.PRIVATE_KEY_PATH),
      'utf8',
    ),
    publicKey: readFileSync(
      join(process.cwd(), process.env.PUBLIC_KEY_PATH),
      'utf8',
    ),
  },
  // You can add other configurations here as needed
  sso: {
    url: process.env.SSO_URL,
    tokenUrl: process.env.SSO_TOKEN_URL,
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI,
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  },
  next: {
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
  },
});
