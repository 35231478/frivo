/**
 * Trava dos scripts da empresa de demonstração (seed e prints): só aceitam um Postgres NESTE
 * computador. O seed apaga e recria dados; apontado para a produção, seria um desastre — então a
 * regra é estreita: o host da DATABASE_URL tem de ser localhost (ou um socket local).
 * (scripts/vendas/gerar-prints.mjs repete a mesma regra, em JavaScript puro.)
 */
const LOCAIS = ["localhost", "127.0.0.1", "::1", "[::1]"];

/** O host da URL de conexão ("localhost" para socket local; "" se a URL não for válida). */
export function hostDoBanco(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname) return u.hostname;
    return u.searchParams.get("host")?.startsWith("/") ? "localhost" : "";
  } catch {
    return "";
  }
}

export const ehBancoLocal = (url: string | undefined): boolean => LOCAIS.includes(hostDoBanco(url ?? ""));

export function exigirBancoLocal(url = process.env.DATABASE_URL): void {
  if (!ehBancoLocal(url)) {
    throw new Error(`Recusado: DATABASE_URL precisa ser um banco local (localhost), não "${hostDoBanco(url ?? "") || "?"}". A empresa de demonstração nunca vai para a produção.`);
  }
}
