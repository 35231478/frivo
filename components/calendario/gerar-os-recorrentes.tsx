"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Repeat, Check, AlertCircle } from "lucide-react";

export function GerarOsRecorrentes({ mes, ano }: { mes: number; ano: number }) {
  const router = useRouter();
  const [gerando, setGerando] = useState(false);
  const [feedback, setFeedback] = useState<{ tipo: "ok" | "erro"; msg: string } | null>(null);

  async function gerar() {
    setGerando(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/contratos/gerar-os-recorrentes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes, ano }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setFeedback({ tipo: "erro", msg: e.erro ?? "Erro ao gerar." });
        return;
      }
      const data = await res.json();
      setFeedback({ tipo: "ok", msg: `${data.criadas} criada(s), ${data.ignoradas} ignorada(s).` });
      router.refresh();
    } catch {
      setFeedback({ tipo: "erro", msg: "Erro de conexão." });
    } finally {
      setGerando(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" onClick={gerar} loading={gerando}>
        <Repeat className="w-4 h-4" /> Gerar OS recorrentes do mês
      </Button>
      {feedback && (
        <span className={
          feedback.tipo === "ok"
            ? "inline-flex items-center gap-1 text-xs text-success-700"
            : "inline-flex items-center gap-1 text-xs text-red-700"
        }>
          {feedback.tipo === "ok" ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          {feedback.msg}
        </span>
      )}
    </div>
  );
}
