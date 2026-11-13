import { TelaCadastroApoio } from "@/components/config/tela-cadastro-apoio";
import { CentrosCustoTela } from "@/components/cadastros/telas/centros-custo";

/** Cadastro padronizado (lib/cadastros): permissões em registro.ts (ler: qualquer usuário; gravar: Configurações › gerenciar). */
export function TelaCentrosCusto() {
  return (
    <TelaCadastroApoio titulo="Centros de custo" descricao="Alocação das despesas por obra, área ou frota" voltar="/configuracoes/financeiras">
      <CentrosCustoTela />
    </TelaCadastroApoio>
  );
}
