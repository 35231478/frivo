"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { confirmar } from "@/components/ui/avisos";
import { Mail, MessageCircle, Link2, Printer, Pencil, Check, AlertCircle, Undo2, XCircle } from "lucide-react";
import type { EtapaCiclo } from "@/lib/orcamentos/ciclo";

interface AcoesEnvioProps {
  orcamentoId: string;
  codigo: string;
  tokenPublico: string;
  status: string;
  podeEditar: boolean;
  /** Etapa do ciclo (lib/orcamentos/ciclo.ts): decide o que dá para fazer agora */
  etapa?: EtapaCiclo;
}

type Canal = "EMAIL" | "WHATSAPP" | "LINK";

/**
 * Envio rastreável: cada botão manda a proposta por um canal e o servidor registra na linha do
 * tempo (e-mail pelo Resend da empresa ao contato A/C; WhatsApp; link). "Visualizado" vem quando o
 * cliente abre o link. Também: voltar para rascunho (corrigir e reenviar) e registrar recusa.
 */
export function AcoesEnvio({ orcamentoId, tokenPublico, status, podeEditar, etapa }: AcoesEnvioProps) {
  const router = useRouter();
  const [carregando, setCarregando] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tipo: "ok" | "erro"; msg: string } | null>(null);
  const printUrl = `/orcamento/${tokenPublico}/imprimir`;
  const e = etapa ?? (status === "REPROVADO" ? "RECUSADO" : (status as EtapaCiclo));

  async function enviar(canal: Canal) {
    setCarregando(canal);
    setFeedback(null);
    try {
      const res = await fetch(`/api/orcamentos/${orcamentoId}/enviar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ canal }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setFeedback({ tipo: "erro", msg: data.erro ?? "Erro ao enviar." }); return; }

      if (canal === "EMAIL") {
        if (data.emailEnviado) setFeedback({ tipo: "ok", msg: `E-mail enviado para ${data.para}.` });
        else if (data.erroEmail) setFeedback({ tipo: "erro", msg: `${data.erroEmail}${data.mailtoUrl ? " Abrimos o seu e-mail para enviar manualmente." : ""}` });
        else if (!data.mailtoUrl) setFeedback({ tipo: "erro", msg: "Cliente sem e-mail cadastrado (nem no contato A/C)." });
        else setFeedback({ tipo: "ok", msg: "E-mail da empresa não configurado: abrimos o seu e-mail com a proposta." });
        if (!data.emailEnviado && data.mailtoUrl) window.location.href = data.mailtoUrl;
      } else if (canal === "WHATSAPP") {
        if (data.whatsappUrl) window.open(data.whatsappUrl, "_blank", "noopener");
        else setFeedback({ tipo: "erro", msg: "Cliente sem telefone/WhatsApp cadastrado (nem no contato A/C)." });
      } else {
        await navigator.clipboard?.writeText(data.publicUrl).catch(() => {});
        setFeedback({ tipo: "ok", msg: "Link copiado!" });
      }
      router.refresh();
    } catch {
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

      {(aguardando || podeVoltarRascunho) && (
        <div className="flex flex-wrap gap-2">
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
              onClick={() => alterarStatus("RASCUNHO", { titulo: "Voltar para rascunho?", mensagem: "O link deixa de aceitar resposta até você enviar de novo. Dá para editar itens, validade e condições; a linha do tempo guarda o histórico.", confirmarTexto: "Voltar para rascunho" })}
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
