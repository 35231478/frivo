"use client";

import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { TelaCadastroApoio } from "@/components/config/tela-cadastro-apoio";

/** Cadastro padronizado: campos, colunas, validação e permissões em lib/cadastros/registro.ts. */
export function TelaCategoriasFinanceiras() {
  return (
    <TelaCadastroApoio titulo="Categorias financeiras" descricao="Classificação de cobranças e despesas">
      <CadastroPadrao entidade="categorias-financeiras" />
    </TelaCadastroApoio>
  );
}
