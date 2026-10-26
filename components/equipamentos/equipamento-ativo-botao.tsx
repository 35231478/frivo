"use client";

import { confirmar, toast } from "@/components/ui/avisos";
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
    if (!(await confirmar({ mensagem: msg, perigo: ativo, confirmarTexto: ativo ? "Inativar" : "Reativar" }))) return;
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
        toast(e.erro ?? "Erro ao alterar o status do equipamento.", "erro");
        return;
      }
      router.refresh();
    } catch {
      toast("Erro de conexão.", "erro");
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
          ativo ? "text-ink-muted hover:text-atrasado" : "text-ink-muted hover:text-ok-texto",
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
          ? "text-atrasado border-atrasado/20 hover:bg-atrasado-claro"
          : "text-ok-texto border-ok/20 hover:bg-ok-claro",
      )}
    >
      <Icone className={cn("w-4 h-4", carregando && "animate-spin")} /> {rotulo}
    </button>
  );
}
