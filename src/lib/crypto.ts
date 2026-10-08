import { createCipheriv, createDecipheriv, randomBytes } from "crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

function getKey(): Buffer {
  const raw = process.env.MASTER_ENCRYPTION_KEY
  if (!raw) {
    throw new Error("MASTER_ENCRYPTION_KEY 未配置")
  }
  const key = Buffer.from(raw, "base64")
  if (key.length !== 32) {
    throw new Error("MASTER_ENCRYPTION_KEY 必须是 base64 编码的 32 字节密钥")
  }
  return key
}

/**
 * AES-256-GCM 加密，输出格式：base64(iv + authTag + ciphertext)
 * 用于 AIModel.apiKeyEncrypted 等敏感字段的落库加密。
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv, {
    authTagLength: AUTH_TAG_LENGTH,
  })
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString("base64")
}

export function decrypt(payload: string): string {
  const data = Buffer.from(payload, "base64")
  const iv = data.subarray(0, IV_LENGTH)
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv, {
    authTagLength: AUTH_TAG_LENGTH,
  })
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
}
