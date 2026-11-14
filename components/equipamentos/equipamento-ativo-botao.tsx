"use client";

import { confirmar, toast } from "@/components/ui/avisos";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissoes } from "@/components/providers/permissoes-provider";

/**
 * Inativa (DELETE = soft-delete, exige "excluir") ou reativa (PATCH, exige "editar")
 * um equipamento. Inativar pede confirmação; reativar vai direto. Sem a permissão correspondente, não
 * renderiza nada. O histórico de OS, formulários e o QR Code são preservados. Toda gravação avisa (toast);
 * recusada pelo servidor, a tela fica como está.
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
    // Reativar não destrói nada: vai direto. Inativar pede confirmação.
    if (ativo && !(await confirmar({
      titulo: `Inativar ${nome}?`, mensagem: "Sai das listas de seleção. O histórico e o QR Code ficam, e o equipamento pode ser reativado.",
      perigo: true, confirmarTexto: "Inativar",
    }))) return;
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
        toast(e.erro ?? "Não foi possível alterar o equipamento.", "erro");
        return;
      }
      toast(ativo ? "Equipamento inativado." : "Equipamento reativado.");
      router.refresh();
    } catch {
      toast("Sem conexão. Tente de novo.", "erro");
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
        title={rotulo} aria-label={`${rotulo} ${nome}`} data-alternar-equipamento={id}
        disabled={carregando}
        onClick={executar}
        className={cn(
          "p-1.5 rounded hover:bg-surface-alt disabled:opacity-50",
          ativo ? "text-ink-muted hover:text-atrasado" : "text-ink-muted hover:text-ok-texto",
        )}
      >
        <Icone className={cn("w-4 h-4", carregando && "animate-spin")} />
      </button>
    );
  }

  return (
    <button
      type="button" data-alternar-equipamento={id}
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
