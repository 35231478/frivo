import { auth } from "@/lib/auth";
import { carregarImplantacao } from "@/lib/implantacao/servidor";
import { PageHeader } from "@/components/ui/page-header";
import { PainelImplantacao } from "@/components/implantacao/painel-implantacao";

/**
 * Configurações › Conta › Implantação — sempre disponível (para novas importações depois de pronto).
 * As contagens são do cadastro real da empresa da sessão; os atalhos respeitam permissão e módulos.
 */
export async function TelaImplantacao() {
  const session = await auth();
  const { etapas, progresso } = await carregarImplantacao(session!.user!.empresaId);
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Implantação"
        description="O passo a passo para começar a usar o Frivo"
        dica="Cada etapa mostra o que já está cadastrado, contado na hora. As planilhas se ligam umas às outras (cliente pelo CNPJ/CPF, colaborador pelo CPF), por isso a ordem importa. Etapas de módulos desligados não aparecem. Até chegar a 100%, a implantação fica em destaque no painel."
        backHref="/configuracoes?aba=conta"
      />
      <PainelImplantacao etapas={etapas} progresso={progresso} />
    </div>
  );
}
