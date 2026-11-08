"use server";

import { criarLeadDoSite, type ResultadoLead } from "@/lib/leads/criar-lead-site";

/**
 * Server action da calculadora pública (first-party): cria o lead DIRETO pela função compartilhada,
 * sem token (mesma origem). Nunca perde o lead em silêncio — devolve `{ ok:false, erro }` com
 * mensagem clara, ou `{ ok:true, codigo }`.
 */
export async function enviarLead(dados: unknown): Promise<ResultadoLead> {
  try {
    return await criarLeadDoSite(dados, "Calculadora de BTU do app Frivo");
  } catch (e) {
    console.error("[calculadora] Erro ao criar o lead:", e);
    return { ok: false, erro: "Não foi possível enviar agora. Tente de novo em instantes." };
  }
}
