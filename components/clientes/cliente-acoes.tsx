"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, MoreVertical, Eye, Ban, Loader2 } from "lucide-react";
import { usePermissoes } from "@/components/providers/permissoes-provider";

/**
 * Ações da linha de cliente na listagem: ícone de editar (lápis) + menu "3 pontinhos"
 * com "Editar"/"Visualizar" e "Inativar cliente". Segue o padrão corporativo/discreto
 * dos demais ícones de ação do sistema (cinza por padrão, primário no hover, sem fundo).
 *
 * Não há tela de detalhes separada: a ficha do cliente é a própria tela de edição,
 * que abre em modo somente leitura para quem não tem permissão de editar. Por isso o
 * item do menu se chama "Editar" (com permissão) ou "Visualizar" (sem permissão).
 *
 * As ações respeitam o RBAC do módulo "clientes" (o servidor também valida):
 * - editar  → lápis e item "Editar";
 * - excluir → item "Inativar cliente" (soft-delete via DELETE /api/clientes/[id]).
 */
export function ClienteAcoes({ id, nome, ativo = true }: { id: string; nome?: string; ativo?: boolean }) {
  const router = useRouter();
  const { pode } = usePermissoes();
  const [menu, setMenu] = useState(false);
  const [inativando, setInativando] = useState(false);
  const fichaHref = `/clientes/${id}/editar`;
  const podeEditar = pode("clientes", "editar");
  const podeInativar = pode("clientes", "excluir") && ativo;

  async function inativar() {
    setMenu(false);
    const alvo = nome ? `o cliente "${nome}"` : "este cliente";
    if (!confirm(`Inativar ${alvo}? Ele deixará de aparecer nas listagens padrão, mas todo o histórico será preservado.`)) return;
    setInativando(true);
    try {
      const res = await fetch(`/api/clientes/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        alert(e.erro ?? "Erro ao inativar cliente.");
        return;
      }
      router.refresh();
    } catch {
      alert("Erro de conexão.");
    } finally {
      setInativando(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {podeEditar && (
        <Link
          href={fichaHref}
          title="Editar cliente"
          className="p-1 rounded text-ink-muted hover:text-primary-600 transition-colors"
        >
          <Pencil className="w-4 h-4" />
        </Link>
      )}

      <div className="relative">
        <button
          type="button"
          title="Mais ações"
          disabled={inativando}
          onClick={() => setMenu((v) => !v)}
          className="p-1 rounded text-ink-muted hover:text-primary-600 transition-colors disabled:opacity-50"
        >
          {inativando ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
        </button>
        {menu && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
            <div className="absolute right-0 top-full mt-1 z-30 w-44 bg-white border border-surface-border rounded-lg shadow-card-hover py-1 text-left">
              <Link
                href={fichaHref}
                onClick={() => setMenu(false)}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-ink hover:bg-surface-alt"
              >
                {podeEditar
                  ? <><Pencil className="w-3.5 h-3.5" /> Editar</>
                  : <><Eye className="w-3.5 h-3.5" /> Visualizar</>}
              </Link>
              {podeInativar && (
                <button
                  type="button"
                  onClick={inativar}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  <Ban className="w-3.5 h-3.5" /> Inativar cliente
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
