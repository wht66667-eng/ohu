import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const SALT_ROUNDS = 10;

export async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export function randomId() {
  return crypto.randomUUID();
}

// 6 位数字验证码
export function generateCode() {
  return String(crypto.randomInt(100000, 999999));
}
