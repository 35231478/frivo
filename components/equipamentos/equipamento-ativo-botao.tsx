"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissoes } from "@/components/providers/permissoes-provider";

/**
 * Inativa (DELETE = soft-delete, exige "excluir") ou reativa (PATCH, exige "editar")
 * um equipamento, com confirmação. Sem a permissão correspondente, não renderiza nada.
 * O histórico de OS, formulários e o QR Code são preservados.
 */
export function EquipamentoAtivoBotao({
  id, nome, ativo, variante = "icone",
}: {
  id: string;
  nome: string;
  ativo: boolean;
  variante?: "icone" | "botao";
}) {
  const router = useRouter();
  const { pode } = usePermissoes();
  const [carregando, setCarregando] = useState(false);

  const permitido = ativo ? pode("equipamentos", "excluir") : pode("equipamentos", "editar");
  if (!permitido) return null;

  async function executar() {
    const msg = ativo
      ? `Inativar o equipamento "${nome}"? Ele sai das listas de seleção (OS, orçamentos), mas o histórico e o QR Code são preservados.`
      : `Reativar o equipamento "${nome}"?`;
    if (!confirm(msg)) return;
    setCarregando(true);
    try {
      const res = ativo
        ? await fetch(`/api/equipamentos/${id}`, { method: "DELETE" })
        : await fetch(`/api/equipamentos/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ativo: true }),
          });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        alert(e.erro ?? "Erro ao alterar o status do equipamento.");
        return;
      }
      router.refresh();
    } catch {
      alert("Erro de conexão.");
    } finally {
      setCarregando(false);
    }
  }

  const Icone = carregando ? Loader2 : ativo ? Ban : RotateCcw;
  const rotulo = ativo ? "Inativar" : "Reativar";

  if (variante === "icone") {
    return (
      <button
        type="button"
        title={`${rotulo} equipamento`}
        disabled={carregando}
        onClick={executar}
        className={cn(
          "p-1 rounded-md hover:bg-surface-alt disabled:opacity-50",
          ativo ? "text-ink-muted hover:text-red-600" : "text-ink-muted hover:text-emerald-600",
        )}
      >
        <Icone className={cn("w-4 h-4", carregando && "animate-spin")} />
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={carregando}
      onClick={executar}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm border rounded-lg px-3 py-2 disabled:opacity-50 transition-colors",
        ativo
          ? "text-red-600 border-red-200 hover:bg-red-50"
          : "text-emerald-700 border-emerald-200 hover:bg-emerald-50",
      )}
    >
      <Icone className={cn("w-4 h-4", carregando && "animate-spin")} /> {rotulo}
    </button>
  );
}
