import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function signToken(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

export function extractToken(req) {
  const header = req.headers.authorization || '';
  const [type, token] = header.split(' ');
  if (type === 'Bearer' && token) return token;
  return null;
}
