"use client";

import { useState } from "react";
import { CheckCircle2, PenLine, Send } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/avisos";
import { abaPendente } from "@/components/orcamento/envio-proposta";
import { AssinaturaDoCliente } from "@/components/os/aceite-assinatura";
import { useTecnico } from "@/components/tecnico/contexto";
import { MSG_SEM_ESPACO } from "@/lib/tecnico/offline/armazenamento";
import { aceiteNoApp, recadoDoPedido, rotuloDaOs, textoDoAceite, type AceiteLocal } from "@/lib/os/aceite";
import type { ExecucaoTela, NovaOperacao, RetratoAtividade } from "@/lib/tecnico/offline/tipos";
import type { PedidoDeAceite } from "@/lib/os/aceite-server";

/**
 * Aceite do cliente no app do técnico, depois de concluir a atividade que fecha a OS. Dois caminhos:
 *  - o responsável está no local: ele assina na tela (nome + assinatura) — vale sem sinal, sobe pela fila;
 *  - não há ninguém: UM toque manda o link (o e-mail sai do servidor; o WhatsApp abre com a mensagem
 *    pronta). Precisa de sinal; sem ele, a confirmação já fica pendente no portal do cliente.
 */
export function AceiteNaOs({ r, x, aEnviar, registrar }: { r: RetratoAtividade; x: ExecucaoTela; aEnviar: number; registrar: (ops: NovaOperacao[]) => Promise<void> }) {
  const { config, estado } = useTecnico();
  const [assinando, setAssinando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [pedido, setPedido] = useState<string | null>(null);
  const situacao = aceiteNoApp({ atividadeConcluida: x.atividade.status === "CONCLUIDA", retrato: r.aceite, aceiteLocal: x.aceiteLocal });
  if (situacao === "NAO_OFERECE") return null;

  if (situacao === "CONFIRMADO" || situacao === "COLHIDO_NO_APARELHO") {
    const texto = situacao === "CONFIRMADO" ? textoDoAceite({ nome: r.aceite!.nome, confirmadoEm: r.aceite!.confirmadoEm }) : textoDoAceite({ nome: x.aceiteLocal!.nome, confirmadoEm: x.aceiteLocal!.em });
    return (
      <section className="rounded-card bg-success-50 border border-success-200 px-3 py-3 text-success-800 flex items-start gap-2" data-aceite-app={situacao}>
        <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" aria-hidden />
        <span className="min-w-0">
          <span className="block text-sm font-bold">Cliente confirmou o serviço</span>
          <span className="block text-sm" data-aceite-app-texto>{texto}{situacao === "COLHIDO_NO_APARELHO" && aEnviar > 0 ? " (a enviar)" : ""}</span>
        </span>
      </section>
    );
  }

  const semSinal = estado.situacao === "offline" || (typeof navigator !== "undefined" && navigator.onLine === false);
  const cliente = (config.exibirDadosCliente && r.cartao.cliente) || x.atividade.titulo;

  async function assinar(d: AceiteLocal): Promise<string | null> {
    try { await registrar([{ tipo: "aceite", atividadeId: x.atividade.id, dados: d }]); }
    catch { return MSG_SEM_ESPACO; }
    setAssinando(false);
    toast(semSinal ? "Aceite guardado no aparelho: sobe quando houver sinal." : "Aceite do cliente registrado.");
    return null;
  }

  async function enviarLink() {
    if (semSinal) { toast("Sem sinal: a confirmação já fica pendente no portal do cliente. Envie o link quando o sinal voltar.", "info"); return; }
    if (aEnviar > 0) { toast("Aguarde as gravações desta OS subirem e toque de novo.", "info"); return; }
    setEnviando(true);
    const aba = abaPendente(); // abre já no toque: depois de esperar o servidor, o navegador bloquearia
    try {
      const res = await fetch(`/api/ordens/${x.os.id}/aceite/enviar`, { method: "POST" });
      const d: PedidoDeAceite & { erro?: string } = await res.json().catch(() => ({}));
      if (!res.ok) { aba.fechar(); toast(d.erro ?? "Não foi possível enviar o link.", "erro"); return; }
      if (d.whatsappUrl) aba.ir(d.whatsappUrl); else aba.fechar();
      const recado = d.whatsappUrl || d.emailEnviado
        ? recadoDoPedido({ whatsapp: !!d.whatsappUrl, emailEnviado: d.emailEnviado, emailPara: d.emailPara, erroEmail: d.erroEmail })
        : { tipo: "info" as const, texto: "O cliente não tem WhatsApp nem e-mail liberado para o app. A confirmação fica pendente no portal; avise o escritório." };
      toast(recado.texto, recado.tipo);
      setPedido(recado.texto);
    } catch { aba.fechar(); toast("Erro de conexão. Tente de novo.", "erro"); } finally { setEnviando(false); }
  }

  return (
    <section className="rounded-card bg-white border-2 border-primary-200 p-3 space-y-3" data-aceite-app="OFERECE">
      <div>
        <h2 className="text-base font-bold text-ink">Confirmação do cliente</h2>
        <p className="text-sm text-ink-muted">Tem alguém do cliente no local? Peça a assinatura. Se não, envie o link para ele confirmar.</p>
      </div>
      <div className="grid gap-2">
        <button type="button" onClick={() => setAssinando(true)} data-aceite-assinar
          className="w-full rounded-card bg-primary-600 text-white py-4 text-base font-bold inline-flex items-center justify-center gap-2 touch-target">
          <PenLine className="w-5 h-5" aria-hidden /> Cliente assina agora
        </button>
        <button type="button" onClick={enviarLink} disabled={enviando} data-aceite-enviar
          className="w-full rounded-card border border-surface-border bg-white text-ink py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target disabled:opacity-60">
          <Send className="w-5 h-5" aria-hidden /> {enviando ? "Enviando…" : "Enviar link ao cliente"}
        </button>
      </div>
      {pedido && <p role="status" className="text-xs text-ink-muted" data-aceite-pedido>{pedido}</p>}
      <Modal aberto={assinando} onFechar={() => setAssinando(false)} titulo="Aceite do cliente">
        {assinando && <AssinaturaDoCliente resumo={`${rotuloDaOs(r.cartao.osNumero)} · ${cliente}`} aoConfirmar={assinar} aoCancelar={() => setAssinando(false)} />}
      </Modal>
    </section>
  );
}
