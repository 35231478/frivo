"use client";

import { confirmar, toast } from "@/components/ui/avisos";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Eye, Ban, Loader2, RotateCcw } from "lucide-react";
import { usePermissoes } from "@/components/providers/permissoes-provider";

/**
 * Ações da linha de cliente na lista, no padrão das outras listas: ícones discretos na própria linha
 * (cinza; primário ou vermelho ao passar), sem menu de três pontos.
 *
 * Não há tela de detalhes separada: a ficha do cliente é a tela de edição, que abre somente leitura
 * para quem não pode editar. Por isso o ícone é o lápis (com permissão) ou o olho (sem).
 *
 * As ações respeitam o módulo "clientes" (o servidor também valida):
 * - editar  → lápis;
 * - excluir → "Inativar" (reversível; DELETE /api/clientes/[id] só marca como inativo);
 * - editar  → "Reativar" no cliente inativo (PATCH { ativo: true }), a mesma regra da ficha.
 * Recusado pelo servidor, a lista fica como está e o motivo aparece no aviso.
 */
export function ClienteAcoes({ id, nome, ativo = true }: { id: string; nome?: string; ativo?: boolean }) {
  const router = useRouter();
  const { pode } = usePermissoes();
  const [inativando, setInativando] = useState(false);
  const fichaHref = `/clientes/${id}/editar`;
  const podeEditar = pode("clientes", "editar");
  const podeInativar = pode("clientes", "excluir") && ativo;
  const podeReativar = podeEditar && !ativo;
  const alvo = nome ?? "cliente";

  async function reativar() {
    setInativando(true);
    try {
      const res = await fetch(`/api/clientes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ativo: true }) });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        toast(e.erro ?? "Não foi possível reativar o cliente.", "erro");
        return;
      }
      toast("Cliente reativado.");
      router.refresh();
    } catch {
      toast("Sem conexão. Tente de novo.", "erro");
    } finally {
      setInativando(false);
    }
  }

  async function inativar() {
    if (!(await confirmar({
      titulo: nome ? `Inativar ${nome}?` : "Inativar este cliente?",
      mensagem: "Ele sai das listas e dos seletores. O histórico fica guardado e o cadastro pode ser reativado.",
      perigo: true, confirmarTexto: "Inativar",
    }))) return;
    setInativando(true);
    try {
      const res = await fetch(`/api/clientes/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        toast(e.erro ?? "Não foi possível inativar o cliente.", "erro");
        return;
      }
      toast("Cliente inativado.");
      router.refresh();
    } catch {
      toast("Sem conexão. Tente de novo.", "erro");
    } finally {
      setInativando(false);
    }
  }

  const btn = "p-1.5 rounded text-ink-muted hover:text-primary-600 hover:bg-primary-50 transition-colors disabled:opacity-50";
  return (
    <span className="inline-flex items-center justify-end gap-0.5" data-acoes-cliente={id}>
      <Link href={fichaHref} aria-label={`${podeEditar ? "Editar" : "Ver"} ${alvo}`} title={podeEditar ? "Editar" : "Ver"} className={btn} data-abrir-cliente>
        {podeEditar ? <Pencil className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
      </Link>
      {podeInativar && (
        <button type="button" onClick={() => void inativar()} disabled={inativando} aria-label={`Inativar ${alvo}`} title="Inativar"
          className={`${btn} hover:text-atrasado hover:bg-atrasado-claro`} data-inativar-cliente>
          {inativando ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Ban className="w-4 h-4" aria-hidden />}
        </button>
      )}
      {podeReativar && (
        <button type="button" onClick={() => void reativar()} disabled={inativando} aria-label={`Reativar ${alvo}`} title="Reativar"
          className={`${btn} hover:text-ok-texto hover:bg-ok-claro`} data-reativar-cliente>
          {inativando ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <RotateCcw className="w-4 h-4" aria-hidden />}
        </button>
      )}
    </span>
  );
}
