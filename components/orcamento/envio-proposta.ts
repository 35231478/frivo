/**
 * Envio da proposta pelo navegador — o mesmo para a tela do orçamento (AcoesEnvio) e para os ícones
 * da listagem: chama POST /api/orcamentos/[id]/enviar com o canal (o servidor confere a permissão,
 * marca "Enviado" e registra na linha do tempo) e traduz a resposta em mensagem para o usuário.
 */

export type CanalEnvio = "EMAIL" | "WHATSAPP" | "LINK";

export interface RespostaEnvio {
  erro?: string;
  publicUrl?: string;
  mailtoUrl?: string | null;
  whatsappUrl?: string | null;
  emailEnviado?: boolean;
  para?: string | null;
  erroEmail?: string | null;
}

export async function pedirEnvio(orcamentoId: string, canal: CanalEnvio): Promise<{ ok: boolean; dados: RespostaEnvio }> {
  const res = await fetch(`/api/orcamentos/${orcamentoId}/enviar`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ canal }),
  });
  const dados: RespostaEnvio = await res.json().catch(() => ({}));
  return { ok: res.ok, dados };
}

/** O que dizer depois do envio por e-mail (e se é para abrir o e-mail do usuário com o mailto). */
export function resultadoEmail(d: RespostaEnvio): { tipo: "ok" | "erro"; msg: string; abrirMailto: boolean } {
  if (d.emailEnviado) return { tipo: "ok", msg: `E-mail enviado para ${d.para}.`, abrirMailto: false };
  if (d.erroEmail) return { tipo: "erro", msg: `${d.erroEmail}${d.mailtoUrl ? " Abrimos o seu e-mail para enviar manualmente." : ""}`, abrirMailto: !!d.mailtoUrl };
  if (!d.mailtoUrl) return { tipo: "erro", msg: "Cliente sem e-mail cadastrado (nem no contato A/C).", abrirMailto: false };
  return { tipo: "ok", msg: "E-mail da empresa não configurado: abrimos o seu e-mail com a proposta.", abrirMailto: true };
}

export const SEM_WHATSAPP = "Cliente sem telefone/WhatsApp cadastrado (nem no contato A/C).";

/**
 * Abre a aba do WhatsApp JÁ no clique (antes de esperar o servidor), senão o navegador bloqueia o
 * pop-up; depois `ir(url)` leva a aba ao wa.me, ou `fechar()` se o envio não deu certo.
 */
export function abaPendente() {
  let aba: Window | null = null;
  try {
    aba = window.open("", "_blank") ?? null;
    if (aba) aba.opener = null;
  } catch {
    aba = null; // sem pop-up (bloqueado/ambiente sem janela): abre no fim, direto
  }
  return {
    ir(url: string) {
      if (aba && !aba.closed) aba.location.href = url;
      else window.open(url, "_blank", "noopener");
    },
    fechar() { if (aba && !aba.closed) aba.close(); },
  };
}
