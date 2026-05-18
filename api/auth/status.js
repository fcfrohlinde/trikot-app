import { kv } from '../_lib/auth.js';

export default async function handler(req, res) {
  const userCount = (await kv.get('meta:userCount')) || 0;
  res.json({ setupRequired: userCount === 0 });
}
