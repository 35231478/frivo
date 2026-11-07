"use client";

import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { PageHeader } from "@/components/ui/page-header";
import { CategoriaDoProduto } from "@/components/estoque/categoria-produto";

/** Cadastro padronizado: campos, colunas, validação e permissões em lib/cadastros/registro.ts. */
export function TelaProdutos() {
  return (
    <div>
      <PageHeader title="Produtos" description="Peças e materiais usados nos serviços" backHref="/configuracoes" />
      <div className="bg-white rounded-card border border-surface-border p-4 sm:p-6">
        {/* Categoria (E3.1): nome + comportamento de faturamento; sem categoria = incluso no serviço (padrão) */}
        <CadastroPadrao entidade="produtos" celula={(col, p) => (col === "categoriaProduto" ? <CategoriaDoProduto produto={{ categoriaProduto: p.categoriaProduto }} /> : undefined)} />
      </div>
    </div>
  );
}
