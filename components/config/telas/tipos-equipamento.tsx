import { TelaCadastroApoio } from "@/components/config/tela-cadastro-apoio";
import { TiposEquipamentoTela } from "@/components/cadastros/telas/tipos-equipamento";

/** Cadastro padronizado (lib/cadastros): abas Ativos/Inativos/Todos, impacto, ações em massa. */
export function TelaTiposEquipamento() {
  return (
    <TelaCadastroApoio titulo="Tipos de equipamento" descricao="Categorias de equipamento e seus formulários">
      <TiposEquipamentoTela />
    </TelaCadastroApoio>
  );
}
