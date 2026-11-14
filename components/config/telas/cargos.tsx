"use client";

import { CadastroPadrao } from "@/components/cadastros/cadastro-padrao";
import { TelaCadastroApoio } from "@/components/config/tela-cadastro-apoio";

/** Cadastro padronizado: campos, colunas, validação e permissões em lib/cadastros/registro.ts. */
export function TelaCargos() {
  return (
    <TelaCadastroApoio titulo="Cargos" descricao="Cargos dos colaboradores">
      <CadastroPadrao entidade="cargos" />
    </TelaCadastroApoio>
  );
}
