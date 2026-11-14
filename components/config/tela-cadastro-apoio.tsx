import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";

/**
 * O ESQUELETO das telas de cadastro de apoio (Tipos de OS, Tipos de equipamento, Categorias, Cargos,
 * Centros de custo, Kits…), para todas ficarem iguais:
 *
 *   cabeçalho (título + uma linha do que é) → cartão → o cadastro padrão (components/cadastros).
 *
 * O cadastro padrão já traz o resto do padrão: abas Ativos / Inativos / Todos, busca, paginação no
 * servidor, Novo / Editar / Inativar conforme a permissão, cartões no celular e a explicação no ⓘ.
 * Instrução longa NÃO vai em parágrafo aqui: passe em `ajuda` do cadastro (vira o ⓘ).
 */
export function TelaCadastroApoio({ titulo, descricao, voltar = "/configuracoes", children }: {
  titulo: string;
  /** Uma linha curta dizendo o que é o cadastro */
  descricao: string;
  voltar?: string;
  children: ReactNode;
}) {
  return (
    <div data-tela-cadastro-apoio>
      <PageHeader title={titulo} description={descricao} backHref={voltar} />
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6">{children}</div>
    </div>
  );
}
