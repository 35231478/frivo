"use client";

import Link from "next/link";
import { useState } from "react";
import { Pencil, MoreVertical, Eye } from "lucide-react";

/**
 * Ações da linha de cliente na listagem: ícone de editar (lápis) + menu "3 pontinhos"
 * com "Editar" e "Ver detalhes". Segue o padrão corporativo/discreto dos demais ícones
 * de ação do sistema (cinza por padrão, primário no hover, sem fundo).
 *
 * Hoje não há tela de detalhes separada — ambas as opções abrem a tela de edição
 * (mesma rota do clique no nome). Basta trocar `detalhesHref` quando ela existir.
 */
export function ClienteAcoes({ id }: { id: string }) {
  const [menu, setMenu] = useState(false);
  const editarHref = `/clientes/${id}/editar`;
  const detalhesHref = editarHref;

  return (
    <div className="flex items-center justify-end gap-1">
      <Link
        href={editarHref}
        title="Editar cliente"
        className="p-1 rounded text-ink-muted hover:text-primary-600 transition-colors"
      >
        <Pencil className="w-4 h-4" />
      </Link>

      <div className="relative">
        <button
          type="button"
          title="Mais ações"
          onClick={() => setMenu((v) => !v)}
          className="p-1 rounded text-ink-muted hover:text-primary-600 transition-colors"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
        {menu && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
            <div className="absolute right-0 top-full mt-1 z-30 w-44 bg-white border border-surface-border rounded-lg shadow-card-hover py-1 text-left">
              <Link
                href={editarHref}
                onClick={() => setMenu(false)}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-ink hover:bg-surface-alt"
              >
                <Pencil className="w-3.5 h-3.5" /> Editar
              </Link>
              <Link
                href={detalhesHref}
                onClick={() => setMenu(false)}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-ink hover:bg-surface-alt"
              >
                <Eye className="w-3.5 h-3.5" /> Ver detalhes
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
