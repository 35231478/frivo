"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { confirmar, toast } from "@/components/ui/avisos";
import { copiarTexto } from "@/lib/ui/copiar";
import { buildPublicUrl } from "@/lib/orcamento-helpers";
import { Mail, MessageCircle, Link2, Printer, Pencil, Check, AlertCircle, Undo2, XCircle } from "lucide-react";
import type { EtapaCiclo } from "@/lib/orcamentos/ciclo";
import { abaPendente, pedirEnvio, resultadoEmail, SEM_WHATSAPP, type CanalEnvio } from "@/components/orcamento/envio-proposta";
import { BotaoClienteAprovou } from "@/components/orcamento/aprovacao-equipe";
import { usePermissoes } from "@/components/providers/permissoes-provider";

interface AcoesEnvioProps {
  orcamentoId: string;
  codigo: string;
  tokenPublico: string;
  status: string;
  podeEditar: boolean;
  /** Etapa do ciclo (lib/orcamentos/ciclo.ts): decide o que dá para fazer agora */
  etapa?: EtapaCiclo;
}


/**
 * Envio rastreável: cada botão manda a proposta por um canal e o servidor registra na linha do
 * tempo (e-mail pelo Resend da empresa ao contato A/C; WhatsApp; link). "Visualizado" vem quando o
 * cliente abre o link. Também: voltar para rascunho (corrigir e reenviar) e registrar recusa.
 */
export function AcoesEnvio({ orcamentoId, tokenPublico, status, podeEditar, etapa }: AcoesEnvioProps) {
  const router = useRouter();
  const [carregando, setCarregando] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tipo: "ok" | "erro"; msg: string } | null>(null);
  /** O navegador recusou a cópia: o link fica à vista, já selecionado, para copiar à mão */
  const [linkManual, setLinkManual] = useState<string | null>(null);
  const printUrl = `/orcamento/${tokenPublico}/imprimir`;
  const e = etapa ?? (status === "REPROVADO" ? "RECUSADO" : (status as EtapaCiclo));

  /**
   * Copiar link: a cópia começa NO CLIQUE (antes de esperar o servidor — o Safari recusa depois) com o
   * link montado aqui (o mesmo que o servidor monta: origem + /orcamento/<token>); depois o servidor
   * registra o envio. Copiou → toast. Não copiou (ou o servidor devolveu outro endereço) → o link
   * aparece selecionado para copiar à mão. Nunca diz "copiado" sem ter copiado.
   */
  async function copiarLink() {
    const url = buildPublicUrl(tokenPublico, window.location.origin);
    const copia = copiarTexto(url);
    setCarregando("LINK");
    setFeedback(null);
    setLinkManual(null);
    try {
      const { ok, dados } = await pedirEnvio(orcamentoId, "LINK");
      if (!ok) { toast(dados.erro ?? "Não foi possível gerar o link.", "erro"); return; }
      const final = dados.publicUrl || url;
      if ((await copia) && final === url) toast("Link copiado.");
      else {
        setLinkManual(final);
        toast("Não foi possível copiar. Copie o link selecionado abaixo.", "info");
      }
      router.refresh();
    } catch {
      toast("Erro de conexão.", "erro");
    } finally {
      setCarregando(null);
    }
  }

  async function enviar(canal: CanalEnvio) {
    if (canal === "LINK") return copiarLink();
    setCarregando(canal);
    setFeedback(null);
    const aba = canal === "WHATSAPP" ? abaPendente() : null;
    try {
      const { ok, dados: data } = await pedirEnvio(orcamentoId, canal);
      if (!ok) { aba?.fechar(); setFeedback({ tipo: "erro", msg: data.erro ?? "Erro ao enviar." }); return; }

      if (canal === "EMAIL") {
        const r = resultadoEmail(data);
        setFeedback({ tipo: r.tipo, msg: r.msg });
        if (r.abrirMailto && data.mailtoUrl) window.location.href = data.mailtoUrl;
      } else if (canal === "WHATSAPP") {
        if (data.whatsappUrl) aba?.ir(data.whatsappUrl);
        else { aba?.fechar(); setFeedback({ tipo: "erro", msg: SEM_WHATSAPP }); }
      }
      router.refresh();
    } catch {
      aba?.fechar();
      setFeedback({ tipo: "erro", msg: "Erro de conexão." });
    } finally {
      setCarregando(null);
    }
  }

  async function alterarStatus(novo: string, pergunta: { titulo: string; mensagem: string; confirmarTexto: string }) {
    if (!(await confirmar(pergunta))) return;
    setCarregando(`status-${novo}`);
    setFeedback(null);
    try {
      const res = await fetch(`/api/orcamentos/${orcamentoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: novo }),
      });
      if (res.ok) router.refresh();
      else {
        const err = await res.json().catch(() => ({}));
        setFeedback({ tipo: "erro", msg: err.erro ?? "Não foi possível alterar o status." });
      }
    } catch {
      setFeedback({ tipo: "erro", msg: "Erro de conexão." });
    } finally {
      setCarregando(null);
    }
  }

  const podeEnviar = e === "RASCUNHO" || e === "ENVIADO" || e === "VISUALIZADO" || e === "RECUSADO";
  const aguardando = e === "ENVIADO" || e === "VISUALIZADO";
  const podeVoltarRascunho = aguardando || e === "EXPIRADO" || e === "RECUSADO";
  // "Cliente aprovou" (espelho do "Cliente recusou"): aguardando o cliente ou ainda em rascunho; quem aprova orçamentos
  const { pode } = usePermissoes();
  const podeAprovarPorFora = (aguardando || e === "RASCUNHO") && pode("orcamentos", "aprovar");

  return (
    <div className="space-y-3" data-acoes-envio>
      {feedback && (
        <div
          role="status"
          className={
            feedback.tipo === "ok"
              ? "bg-success-50 border border-success-200 text-success-700 text-sm rounded-lg px-3 py-2 flex items-center gap-2"
              : "bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2 flex items-center gap-2"
          }
          data-feedback-envio
        >
          {feedback.tipo === "ok" ? <Check className="w-4 h-4" aria-hidden /> : <AlertCircle className="w-4 h-4" aria-hidden />}
          {feedback.msg}
        </div>
      )}

      {linkManual && <LinkParaCopiar url={linkManual} />}

      {e === "EXPIRADO" && (
        <p className="text-sm text-atencao-texto bg-atencao-claro rounded-lg px-3 py-2" data-aviso-expirado>
          A validade venceu sem resposta do cliente. Volte para rascunho, ajuste a validade e envie de novo.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {podeEnviar && (
          <>
            <Button variant="primary" onClick={() => enviar("EMAIL")} loading={carregando === "EMAIL"} data-enviar-email>
              <Mail className="w-4 h-4" aria-hidden /> {e === "RASCUNHO" ? "Enviar por e-mail" : "Reenviar por e-mail"}
            </Button>
            <Button variant="secondary" onClick={() => enviar("WHATSAPP")} loading={carregando === "WHATSAPP"} data-enviar-whatsapp>
              <MessageCircle className="w-4 h-4" aria-hidden /> WhatsApp
            </Button>
            <Button variant="outline" onClick={() => enviar("LINK")} loading={carregando === "LINK"} data-copiar-link>
              <Link2 className="w-4 h-4" aria-hidden /> Copiar link
            </Button>
          </>
        )}
        <Link href={printUrl} target="_blank" rel="noopener" className="btn-secondary">
          <Printer className="w-4 h-4" aria-hidden /> Gerar PDF
        </Link>
        {podeEditar && (
          <Link href={`/orcamentos/${orcamentoId}/editar`} className="btn-secondary">
            <Pencil className="w-4 h-4" aria-hidden /> Editar
          </Link>
        )}
      </div>

      {(aguardando || podeVoltarRascunho || podeAprovarPorFora) && (
        <div className="flex flex-wrap gap-2">
          {podeAprovarPorFora && <BotaoClienteAprovou orcamentoId={orcamentoId} />}
          {aguardando && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => alterarStatus("REPROVADO", { titulo: "Registrar recusa?", mensagem: "Use quando o cliente recusou por fora do link (telefone, e-mail). O orçamento passa para Recusado.", confirmarTexto: "Registrar recusa" })}
              loading={carregando === "status-REPROVADO"}
              data-marcar-recusado
            >
              <XCircle className="w-3.5 h-3.5" aria-hidden /> Cliente recusou
            </Button>
          )}
          {podeVoltarRascunho && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => alterarStatus("RASCUNHO", { titulo: "Voltar para rascunho?", mensagem: "O link deixa de aceitar resposta até novo envio; itens, validade e condições ficam editáveis.", confirmarTexto: "Voltar para rascunho" })}
              loading={carregando === "status-RASCUNHO"}
              data-voltar-rascunho
            >
              <Undo2 className="w-3.5 h-3.5" aria-hidden /> Voltar para rascunho
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** O link à vista e já selecionado, para copiar à mão quando o navegador recusa a cópia automática */
function LinkParaCopiar({ url }: { url: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, [url]);
  return (
    <input
      ref={ref}
      readOnly
      value={url}
      onFocus={(ev) => ev.currentTarget.select()}
      onClick={(ev) => ev.currentTarget.select()}
      aria-label="Link da proposta para copiar"
      className="w-full rounded-lg border border-surface-border bg-white px-3 py-2 text-sm font-mono text-ink"
      data-link-manual
    />
  );
}
