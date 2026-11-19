import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { PageHeader } from "@/components/ui/page-header";
import { MODULOS_COM_GATE } from "@/lib/modulos/catalogo";
import { estadoDosModulos } from "@/lib/modulos/servidor";
import { ModulosClient } from "@/components/config/modulos-client";

/**
 * Configurações › Conta › Módulos — o que esta empresa usa.
 *
 * Fase 1 (piloto): só os módulos cujo gate já vale nas três camadas (menu, rota e API). A loja
 * completa, com todos os módulos do catálogo, vem no PR seguinte.
 */
export async function TelaModulos() {
  const session = await auth();
  const u = session!.user!;
  const modulos = await estadoDosModulos(u.empresaId, MODULOS_COM_GATE);
  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Módulos"
        description="O que esta empresa usa do Frivo"
        dica="Desligar um módulo tira as telas dele do menu e recusa as ações, para todo mundo da empresa — é uma decisão da empresa, não uma permissão de usuário. Nada é apagado: religando, tudo volta como estava. O núcleo (clientes, OS, calendário, equipe e configurações) não desliga."
        backHref="/configuracoes?aba=conta"
      />
      <ModulosClient
        inicial={modulos.map((m) => ({ ...m, alteradoEm: m.alteradoEm ? m.alteradoEm.toISOString() : null }))}
        podeEditar={pode(u.permissoes, "configuracoes", "gerenciar", u.role)}
      />
    </div>
  );
}
