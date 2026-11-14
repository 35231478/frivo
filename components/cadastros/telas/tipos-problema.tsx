"use client";

import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";

/** Tipos de problema do portal no padrão (antes era uma tabela própria, sem permissão nos botões nem celular). */
export function TiposProblemaTela() {
  return (
    <CadastroPadrao
      entidade="tipos-problema"
      ajuda="As opções que o cliente escolhe ao abrir um chamado pelo portal. Inativar uma opção a retira do portal; os chamados já abertos não mudam."
    />
  );
}
