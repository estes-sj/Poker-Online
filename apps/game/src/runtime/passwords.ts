import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashSecret(secret: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(secret, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifySecret(secret: string, storedValue?: string): boolean {
  if (!storedValue) {
    return false;
  }

  const [salt, hash] = storedValue.split(":");

  if (!salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "hex");
  const provided = Buffer.from(scryptSync(secret, salt, 64).toString("hex"), "hex");

  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
