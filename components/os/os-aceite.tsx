"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, Hourglass, Loader2, PenLine, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/avisos";
import { abaPendente } from "@/components/orcamento/envio-proposta";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { AssinaturaDoCliente } from "@/components/os/aceite-assinatura";
import { formatarDataHora } from "@/lib/utils";
import { ROTULO_ESTADO, provaDoAceite, recadoDoPedido, rotuloDaOs, textoDoAceite, textoDoCanal, type AceiteLocal, type EstadoAceite } from "@/lib/os/aceite";
import type { AceiteDaOs, PedidoDeAceite } from "@/lib/os/aceite-server";

interface Resposta { estado: EstadoAceite; statusOs: string; aceite: AceiteDaOs | null; caminhoPublico: string | null; erro?: string }

/**
 * Aceite do cliente na OS (escritório): "concluída, aguardando confirmação do cliente" até o aceite.
 * Quem tem "OS › Editar" envia o link (um clique: e-mail + WhatsApp), copia o link ou colhe a
 * assinatura na hora. Confirmado, mostra a prova: quem, quando, como e de onde.
 */
export function OsAceite({ osId, numero, cliente, statusOs, aoMudar }: {
  osId: string; numero: string; cliente: string; statusOs: string;
  /** Avisa a tela da OS (o selo do cabeçalho e o "o que falta" acompanham) */
  aoMudar?: (aceite: { situacao: string; nome: string | null; confirmadoEm: string | null; metodo: string | null } | null) => void;
}) {
  const { pode } = usePermissoes();
  const podeEditar = pode("ordens", "editar");
  const [dados, setDados] = useState<Resposta | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [assinando, setAssinando] = useState(false);
  const [erro, setErro] = useState("");

  const guardar = useCallback((d: Resposta) => {
    setDados(d);
    aoMudar?.(d.aceite ? { situacao: d.aceite.situacao, nome: d.aceite.nome, confirmadoEm: d.aceite.confirmadoEm, metodo: d.aceite.metodo } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const carregar = useCallback(async () => {
    try {
      const res = await fetch(`/api/ordens/${osId}/aceite`);
      const d = await res.json().catch(() => ({}));
      if (res.ok) guardar(d);
    } catch { /* sem conexão: o cartão não aparece */ }
  }, [osId, guardar]);
  // Relê quando o status da OS muda (concluir abre o aceite; reabrir tira o "aguardando")
  useEffect(() => { void carregar(); }, [carregar, statusOs]);

  async function enviar() {
    setErro(""); setEnviando(true);
    const aba = abaPendente(); // abre já no clique: depois de esperar o servidor, o navegador bloquearia
    try {
      const res = await fetch(`/api/ordens/${osId}/aceite/enviar`, { method: "POST" });
      const d: PedidoDeAceite & { erro?: string } = await res.json().catch(() => ({}));
      if (!res.ok) { aba.fechar(); setErro(d.erro ?? "Não foi possível enviar."); return; }
      if (d.whatsappUrl) aba.ir(d.whatsappUrl); else aba.fechar();
      if (d.canal === "LINK") { try { await navigator.clipboard.writeText(d.publicUrl); } catch { setErro(`Copie o link: ${d.publicUrl}`); } }
      const recado = recadoDoPedido({ whatsapp: !!d.whatsappUrl, emailEnviado: d.emailEnviado, emailPara: d.emailPara, erroEmail: d.erroEmail });
      toast(recado.texto, recado.tipo);
      await carregar();
    } catch { aba.fechar(); setErro("Erro de conexão."); } finally { setEnviando(false); }
  }
  async function copiar() {
    if (!dados?.caminhoPublico) return;
    const url = `${window.location.origin}${dados.caminhoPublico}`;
    try { await navigator.clipboard.writeText(url); toast("Link copiado."); } catch { setErro(`Copie o link: ${url}`); }
  }
  async function assinar(d: AceiteLocal): Promise<string | null> {
    const res = await fetch(`/api/ordens/${osId}/aceite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) return r.erro ?? "Não foi possível registrar o aceite.";
    setAssinando(false);
    toast("Aceite do cliente registrado.");
    await carregar();
    return null;
  }

  if (!dados) return null;
  const { estado, aceite } = dados;
  // OS concluída antes de existir o aceite: quem edita pode pedir a confirmação mesmo assim
  const semRegistro = estado === "NAO_SE_APLICA" && dados.statusOs === "CONCLUIDA" && !aceite;
  if (estado === "NAO_SE_APLICA" && !(semRegistro && podeEditar)) return null;

  if (estado === "CONFIRMADO" && aceite) {
    return (
      <section className="bg-ok-claro border border-ok/20 rounded-card px-4 py-3 flex items-start gap-3 flex-wrap" data-aceite-os="CONFIRMADO">
        <CheckCircle2 className="w-5 h-5 text-ok-texto shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-semibold text-ok-texto" data-aceite-titulo>{ROTULO_ESTADO.CONFIRMADO}</p>
          <p className="text-sm text-ink" data-aceite-quem>{textoDoAceite(aceite)}</p>
          <p className="text-xs text-ink-muted" data-aceite-prova>{provaDoAceite(aceite)}</p>
          {aceite.observacao && <p className="text-sm text-ink break-words" data-aceite-observacao>Observação do cliente: {aceite.observacao}</p>}
        </div>
        {aceite.assinatura && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={aceite.assinatura} alt={`Assinatura de ${aceite.nome ?? "cliente"}`} className="h-14 max-w-[10rem] object-contain bg-white rounded border border-surface-border" data-aceite-assinatura />
        )}
      </section>
    );
  }

  return (
    <section className="bg-atencao-claro border border-atencao/20 rounded-card px-4 py-3 space-y-2" data-aceite-os={semRegistro ? "SEM_REGISTRO" : "AGUARDANDO"}>
      <div className="flex items-start gap-3 flex-wrap">
        <Hourglass className="w-5 h-5 text-atencao-texto shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-sm font-semibold text-atencao-texto" data-aceite-titulo>{semRegistro ? "Sem confirmação do cliente" : ROTULO_ESTADO.AGUARDANDO}</p>
          <p className="text-sm text-ink">
            {semRegistro ? "OS concluída antes do aceite existir. Dá para pedir a confirmação agora." : "A OS está concluída e pode ser faturada. Falta o cliente confirmar o recebimento."}
          </p>
          {aceite?.enviadoEm && (
            <p className="text-xs text-ink-muted" data-aceite-envio>
              Último pedido em {formatarDataHora(aceite.enviadoEm)}, {textoDoCanal(aceite.enviadoCanal)}{aceite.enviadoPara ? ` (${aceite.enviadoPara})` : ""}.
            </p>
          )}
        </div>
        {podeEditar && (
          <div className="flex items-center gap-2 flex-wrap" data-acoes-aceite>
            <Button type="button" size="sm" onClick={enviar} loading={enviando} data-enviar-aceite><Send className="w-4 h-4" aria-hidden /> Enviar ao cliente</Button>
            {!semRegistro && (
              <>
                <Button type="button" size="sm" variant="secondary" onClick={copiar} data-copiar-aceite><Copy className="w-4 h-4" aria-hidden /> Copiar link</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => { setErro(""); setAssinando(true); }} data-colher-aceite><PenLine className="w-4 h-4" aria-hidden /> Colher assinatura</Button>
              </>
            )}
          </div>
        )}
      </div>
      {enviando && <p className="text-xs text-ink-muted flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Enviando…</p>}
      {erro && <p role="alert" className="text-sm text-atrasado-texto break-all" data-erro-aceite-os>{erro}</p>}
      <Modal aberto={assinando} onFechar={() => setAssinando(false)} titulo="Aceite do cliente">
        {assinando && <AssinaturaDoCliente resumo={`${rotuloDaOs(numero)} · ${cliente}`} aoConfirmar={assinar} aoCancelar={() => setAssinando(false)} />}
      </Modal>
    </section>
  );
}
