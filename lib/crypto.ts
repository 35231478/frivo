import crypto from "crypto";

/**
 * Criptografia simétrica (AES-256-GCM) para segredos em repouso (credenciais e
 * certificado da integração bancária). A chave vem de ENCRYPTION_KEY; se ausente,
 * deriva de NEXTAUTH_SECRET — assim funciona sem variável extra, mas o ideal em
 * produção é definir ENCRYPTION_KEY (32+ caracteres aleatórios).
 */
function obterChave(): Buffer {
  const raw = process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || "";
  if (!raw) throw new Error("ENCRYPTION_KEY ou NEXTAUTH_SECRET não configurado.");
  return crypto.createHash("sha256").update(raw).digest(); // 32 bytes
}

export function criptografar(texto: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", obterChave(), iv);
  const enc = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function descriptografar(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const partes = payload.split(".");
  if (partes.length !== 3) return null;
  try {
    const [ivB, tagB, dataB] = partes;
    const decipher = crypto.createDecipheriv("aes-256-gcm", obterChave(), Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}
