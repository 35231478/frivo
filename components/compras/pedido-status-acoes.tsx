"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowRight, Ban, Check, AlertCircle } from "lucide-react";

const PROXIMO: Record<string, { status: string; label: string } | null> = {
  SOLICITADO: { status: "COTANDO", label: "Iniciar cotação" },
  COTANDO: { status: "COMPRADO", label: "Marcar como comprado" },
  COMPRADO: { status: "ENTREGUE", label: "Marcar como entregue" },
  ENTREGUE: null,
  CANCELADO: null,
};

export function PedidoStatusAcoes({ pedidoId, status }: { pedidoId: string; status: string }) {
  const router = useRouter();
  const [carregando, setCarregando] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tipo: "ok" | "erro"; msg: string } | null>(null);

  const proximo = PROXIMO[status];

  async function mudar(novo: string) {
    setCarregando(novo);
    setFeedback(null);
    try {
      const res = await fetch(`/api/pedidos-compra/${pedidoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: novo }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setFeedback({ tipo: "erro", msg: e.erro ?? "Erro ao atualizar." });
        return;
      }
      const data = await res.json();
      if (data.whatsappGestor) window.open(data.whatsappGestor, "_blank", "noopener");
      if (data.whatsappTecnico) window.open(data.whatsappTecnico, "_blank", "noopener");
      setFeedback({ tipo: "ok", msg: "Status atualizado." });
      router.refresh();
    } catch {
      setFeedback({ tipo: "erro", msg: "Erro de conexão." });
    } finally {
      setCarregando(null);
    }
  }

  return (
    <div className="space-y-3">
      {feedback && (
        <div className={
          feedback.tipo === "ok"
            ? "bg-success-50 border border-success-200 text-success-700 text-sm rounded-lg px-3 py-2 flex items-center gap-2"
            : "bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 flex items-center gap-2"
        }>
          {feedback.tipo === "ok" ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {feedback.msg}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {proximo && (
          <Button variant="primary" onClick={() => mudar(proximo.status)} loading={carregando === proximo.status}>
            {proximo.label} <ArrowRight className="w-4 h-4" />
          </Button>
        )}
        {status !== "ENTREGUE" && status !== "CANCELADO" && (
          <Button variant="ghost" size="sm" onClick={() => { if (confirm("Cancelar este pedido?")) mudar("CANCELADO"); }} loading={carregando === "CANCELADO"}>
            <Ban className="w-3.5 h-3.5" /> Cancelar pedido
          </Button>
        )}
      </div>
    </div>
  );
}
