"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, QrCode } from "lucide-react";

/**
 * "Gerar QR" direto na ficha do equipamento. Usado por quem pode CRIAR equipamentos
 * mas não editar (sem acesso à aba QR Code da edição): só gera/vincula, não desvincula.
 */
export function GerarQrBotao({ equipamentoId, variante = "link" }: { equipamentoId: string; variante?: "link" | "botao" }) {
  const router = useRouter();
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  async function gerar() {
    setErro(""); setCarregando(true);
    try {
      const res = await fetch(`/api/equipamentos/${equipamentoId}/qrcode`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Erro ao gerar."); return; }
      router.refresh();
    } catch { setErro("Erro de conexão."); } finally { setCarregando(false); }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {erro && <span className="text-xs text-red-600">{erro}</span>}
      <button
        type="button" onClick={gerar} disabled={carregando} data-gerar-qr
        className={variante === "botao"
          ? "inline-flex items-center gap-1.5 text-sm text-ink border border-surface-border rounded-lg px-3 py-2 hover:border-primary-300 hover:text-primary-600 disabled:opacity-50"
          : "inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 disabled:opacity-50"}
      >
        {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : variante === "botao" ? <QrCode className="w-4 h-4" /> : null} Gerar QR
      </button>
    </span>
  );
}
