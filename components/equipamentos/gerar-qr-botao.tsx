"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, QrCode } from "lucide-react";
import { toast } from "@/components/ui/avisos";

/**
 * "Gerar QR" direto na ficha do equipamento. Usado por quem pode CRIAR equipamentos
 * mas não editar (sem acesso à aba QR Code da edição): só gera/vincula, não desvincula.
 * A gravação avisa (toast); recusada pelo servidor, a ficha fica como está e o motivo aparece.
 */
export function GerarQrBotao({ equipamentoId, variante = "link" }: { equipamentoId: string; variante?: "link" | "botao" }) {
  const router = useRouter();
  const [carregando, setCarregando] = useState(false);
  async function gerar() {
    setCarregando(true);
    try {
      const res = await fetch(`/api/equipamentos/${equipamentoId}/qrcode`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast(d.erro ?? "Não foi possível gerar o QR Code.", "erro"); return; }
      toast(d.codigo ? `QR Code ${d.codigo} gerado.` : "QR Code gerado.");
      router.refresh();
    } catch { toast("Sem conexão. Tente de novo.", "erro"); } finally { setCarregando(false); }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button" onClick={gerar} disabled={carregando} data-gerar-qr
        className={variante === "botao"
          ? "inline-flex items-center gap-1.5 text-sm text-ink border border-surface-border rounded-lg px-3 py-2 hover:border-primary-300 hover:text-primary-600 disabled:opacity-50"
          : "inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 disabled:opacity-50"}
      >
        {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : variante === "botao" ? <QrCode className="w-4 h-4" aria-hidden /> : null} Gerar QR
      </button>
    </span>
  );
}
