import { TelaCadastroApoio } from "@/components/config/tela-cadastro-apoio";
import { TiposOsTela } from "@/components/cadastros/telas/tipos-os";

/** Cadastro padronizado (lib/cadastros): permissões em registro.ts (ler: qualquer usuário; gravar: Configurações › gerenciar). */
export function TelaTiposOs() {
  return (
    <TelaCadastroApoio titulo="Tipos de OS" descricao="Tipos de serviço executados pela empresa">
      <TiposOsTela />
    </TelaCadastroApoio>
  );
}
