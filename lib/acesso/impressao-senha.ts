import { createHash } from "node:crypto";

/**
 * "Impressão" da senha atual: hash do hash, curto. Vai no link de convite/recuperação (uso único) e
 * na sessão (trocou a senha → as sessões com a impressão antiga caem). Não permite recuperar a senha.
 */
export const impressaoDaSenha = (senhaHash: string) => createHash("sha256").update(senhaHash).digest("base64url").slice(0, 22);
