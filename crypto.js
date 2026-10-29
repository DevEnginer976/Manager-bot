import crypto from "node:crypto";

function key() {
  const value = process.env.MASTER_ENCRYPTION_KEY || "";
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("MASTER_ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes).");
  }
  return Buffer.from(value, "hex");
}
export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { data: encrypted.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}
export function decrypt(row) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(row.token_iv, "base64"));
  decipher.setAuthTag(Buffer.from(row.token_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.token_enc, "base64")),
    decipher.final()
  ]).toString("utf8");
}
