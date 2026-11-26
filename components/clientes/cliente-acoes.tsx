"use client";

import Link from "next/link";
import { Pencil, Eye } from "lucide-react";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { InativarRegistro } from "@/components/ui/inativar-registro";

/**
 * Ações da linha de cliente na lista, no padrão das outras listas: ícones discretos na própria linha
 * (cinza; primário ou vermelho ao passar), sem menu de três pontos.
 *
 * Não há tela de detalhes separada: a ficha do cliente é a tela de edição, que abre somente leitura
 * para quem não pode editar. Por isso o ícone é o lápis (com permissão) ou o olho (sem).
 *
 * Inativar/Reativar é o botão padrão dos cadastros (InativarRegistro): a mesma confirmação da ficha,
 * com o que continua andando (contratos, OS, cobranças) antes de confirmar.
 * - excluir → "Inativar" (reversível; DELETE /api/clientes/[id] só marca como inativo);
 * - editar  → "Reativar" no cliente inativo (PATCH { ativo: true }), a mesma regra da ficha.
 * Recusado pelo servidor, a lista fica como está e o motivo aparece no modal.
 */
export function ClienteAcoes({ id, nome, ativo = true }: { id: string; nome?: string; ativo?: boolean }) {
  const { pode } = usePermissoes();
  const podeEditar = pode("clientes", "editar");
  // O lápis vai direto para a edição; sem permissão de editar, o olho abre a ficha em consulta
  const fichaHref = podeEditar ? `/clientes/${id}/editar` : `/clientes/${id}`;
  const alvo = nome ?? "cliente";

  const btn = "p-1.5 rounded text-ink-muted hover:text-primary-600 hover:bg-primary-50 transition-colors disabled:opacity-50";
  return (
    <span className="inline-flex items-center justify-end gap-0.5" data-acoes-cliente={id}>
      <Link href={fichaHref} aria-label={`${podeEditar ? "Editar" : "Ver"} ${alvo}`} title={podeEditar ? "Editar" : "Ver"} className={btn} data-abrir-cliente>
        {podeEditar ? <Pencil className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
      </Link>
      <InativarRegistro url={`/api/clientes/${id}`} modulo="clientes" acaoReativar="editar" ativo={ativo} nome={nome ?? ""} entidade="cliente" comMotivo={false} />
    </span>
  );
}
