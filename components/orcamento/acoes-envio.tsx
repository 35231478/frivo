"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Mail, MessageCircle, Link2, Printer, Send, Ban, Pencil, Check, AlertCircle } from "lucide-react";

interface AcoesEnvioProps {
  orcamentoId: string;
  codigo: string;
  tokenPublico: string;
  status: string;
  podeEditar: boolean;
}

export function AcoesEnvio({ orcamentoId, codigo, tokenPublico, status, podeEditar }: AcoesEnvioProps) {
  const router = useRouter();
  const [carregando, setCarregando] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tipo: "ok" | "erro"; msg: string } | null>(null);

  const publicUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/orcamento/${tokenPublico}`
      : `/orcamento/${tokenPublico}`;
  const printUrl = `/orcamento/${tokenPublico}/imprimir`;

  async function enviar(viaAposta: "mailto" | "whatsapp" | "copiar") {
    setCarregando(viaAposta);
    setFeedback(null);
    try {
      const res = await fetch(`/api/orcamentos/${orcamentoId}/enviar`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFeedback({ tipo: "erro", msg: err.erro ?? "Erro ao enviar." });
        return;
      }
      const data = await res.json();

      if (viaAposta === "mailto") {
        if (data.mailtoUrl) {
          window.location.href = data.mailtoUrl;
        } else {
          setFeedback({ tipo: "erro", msg: "Cliente sem e-mail cadastrado." });
        }
      } else if (viaAposta === "whatsapp") {
        if (data.whatsappUrl) {
          window.open(data.whatsappUrl, "_blank", "noopener");
        } else {
          setFeedback({ tipo: "erro", msg: "Cliente sem telefone cadastrado." });
        }
      } else {
        await navigator.clipboard.writeText(data.publicUrl);
        setFeedback({ tipo: "ok", msg: "Link copiado!" });
      }
      router.refresh();
    } catch {
      setFeedback({ tipo: "erro", msg: "Erro de conexão." });
    } finally {
      setCarregando(null);
    }
  }

  async function alterarStatus(novo: string, confirmacao?: string) {
    if (confirmacao && !confirm(confirmacao)) return;
    setCarregando(`status-${novo}`);
    try {
      const res = await fetch(`/api/orcamentos/${orcamentoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: novo }),
      });
      if (res.ok) router.refresh();
    } finally {
      setCarregando(null);
    }
  }

  const podeEnviar = status === "RASCUNHO" || status === "ENVIADO" || status === "REPROVADO";
  const podeCancelar = status !== "APROVADO" && status !== "CANCELADO";

  return (
    <div className="space-y-3">
      {feedback && (
        <div
          className={
            feedback.tipo === "ok"
              ? "bg-success-50 border border-success-200 text-success-700 text-sm rounded-lg px-3 py-2 flex items-center gap-2"
              : "bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 flex items-center gap-2"
          }
        >
          {feedback.tipo === "ok" ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {feedback.msg}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {podeEnviar && (
          <>
            <Button
              variant="primary"
              onClick={() => enviar("mailto")}
              loading={carregando === "mailto"}
            >
              <Mail className="w-4 h-4" /> Enviar por E-mail
            </Button>
            <Button
              variant="success"
              onClick={() => enviar("whatsapp")}
              loading={carregando === "whatsapp"}
            >
              <MessageCircle className="w-4 h-4" /> Enviar por WhatsApp
            </Button>
            <Button
              variant="outline"
              onClick={() => enviar("copiar")}
              loading={carregando === "copiar"}
            >
              <Link2 className="w-4 h-4" /> Copiar link
            </Button>
          </>
        )}
        <Link href={printUrl} target="_blank" rel="noopener" className="btn-secondary">
          <Printer className="w-4 h-4" /> Gerar PDF
        </Link>
        {podeEditar && (
          <Link href={`/orcamentos/${orcamentoId}/editar`} className="btn-secondary">
            <Pencil className="w-4 h-4" /> Editar
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {status === "ENVIADO" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => alterarStatus("REPROVADO", "Marcar como reprovado pelo cliente?")}
            loading={carregando === "status-REPROVADO"}
          >
            Marcar como reprovado
          </Button>
        )}
        {podeCancelar && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => alterarStatus("CANCELADO", "Cancelar este orçamento? Esta ação não pode ser desfeita.")}
            loading={carregando === "status-CANCELADO"}
          >
            <Ban className="w-3.5 h-3.5" /> Cancelar orçamento
          </Button>
        )}
      </div>
    </div>
  );
}
