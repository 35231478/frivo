import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { PageHeader } from "@/components/ui/page-header";
import { PadronizacaoClient } from "@/components/config/padronizacao-client";

/** Configurações › Conta › Padronização de digitação (gerenciar as Configurações). */
export async function TelaPadronizacao() {
  const session = await auth();
  const u = session!.user!;
  const podeAplicar = pode(u.permissoes, "configuracoes", "gerenciar", u.role);
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Padronização de digitação"
        description="Ajeita a caixa dos cadastros para um padrão só"
        dica="Nomes de cliente, colaborador, fornecedor, contato, equipe, cidade e endereço viram Nome Próprio; e-mail fica em minúsculo; observações só perdem espaços sobrando. A prévia mostra o que mudaria antes de gravar; aplicar só grava o que muda e pode rodar de novo sem efeito."
        backHref="/configuracoes/conta"
      />
      <PadronizacaoClient podeAplicar={podeAplicar} />
    </div>
  );
}
