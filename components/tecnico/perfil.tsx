"use client";

import { confirmar } from "@/components/ui/avisos";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { AlertTriangle, Car, ChevronDown, LogOut, Percent, Receipt, RefreshCw, Trash2 } from "lucide-react";
import { AvatarTecnico } from "@/components/ui/avatar-tecnico";
import { cn } from "@/lib/utils";
import { PerfilClient } from "@/components/perfil/perfil-client";
import { MinhasComissoes } from "@/components/perfil/minhas-comissoes";
import { rotuloSync } from "@/components/tecnico/indicador-sync";
import { irPara, useTecnico } from "@/components/tecnico/contexto";
import { PreferenciaRota } from "@/components/tecnico/rota";
import { NotificacoesAparelho } from "@/components/push/notificacoes-aparelho";
import type { OperacaoFila } from "@/lib/tecnico/offline/tipos";
import { horaBR } from "@/lib/fuso";

const ROTULO_OPERACAO: Record<string, string> = {
  iniciar: "Início do atendimento", avisoCliente: "A caminho / Cheguei", cadastrarEquipamento: "Equipamento cadastrado", resposta: "Resposta do checklist", audio: "Observação em áudio", tudoOk: "TUDO OK",
  foto: "Foto", fotoRemover: "Foto retirada", equipamento: "Equipamento atendido/observação", formulario: "Formulário",
  vincular: "Equipamento vinculado", scan: "QR Code lido", adicional: "Serviço extra", adicionalRemover: "Serviço extra retirado",
  adicionalFoto: "Foto do serviço extra", adicionalFotoRemover: "Foto do serviço extra retirada",
  fotoOs: "Foto do serviço", fotoOsRemover: "Foto do serviço retirada", fotoOsLegenda: "Legenda da foto do serviço", concluir: "Conclusão da atividade",
  material: "Material usado", materialRemover: "Material excluído", comentario: "Comentário", despesa: "Despesa de campo", aceite: "Aceite do cliente",
};

/**
 * Perfil do técnico, enxuto: sincronização (com o motivo das recusadas), checklist do veículo, Meus
 * dados e sair. Dentro de "Meus dados": dados pessoais, foto, SEGURANÇA (trocar a senha — o único
 * lugar do app) e as preferências do aparelho (app de rota). COM-1: "Minhas comissões" só quando a
 * empresa usa comissão (o mesmo extrato do Meu perfil do painel).
 */
export function PerfilTecnico({ perfilInicial, abrirComissoes = false }: {
  perfilInicial: React.ComponentProps<typeof PerfilClient>["initial"];
  /** Veio do card "Minhas comissões" do Meu dia: a seção aparece já aberta (também sem sinal — ele tem comissão) */
  abrirComissoes?: boolean;
}) {
  const { motor, estado, usuario, config, armazenamento, avatar, definirAvatar } = useTecnico();
  const [fila, setFila] = useState<OperacaoFila[]>([]);
  const [osDe, setOsDe] = useState<Record<string, string>>({});
  const [dados, setDados] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [usaComissao, setUsaComissao] = useState(abrirComissoes);
  const [comissoesAbertas, setComissoesAbertas] = useState(abrirComissoes);
  useEffect(() => {
    let vivo = true;
    fetch("/api/perfil/comissoes?so=ativo").then((r) => (r.ok ? r.json() : null)).then((d) => { if (vivo && d?.ativo) setUsaComissao(true); }).catch(() => {});
    return () => { vivo = false; };
  }, []);
  useEffect(() => {
    if (!motor) return;
    motor.banco.fila().then(setFila);
    motor.banco.retratos().then((rs) => setOsDe(Object.fromEntries(rs.map((r) => [r.atividadeId, [r.retrato.cartao.osNumero, config.exibirDadosCliente && r.retrato.cartao.cliente].filter(Boolean).join(" · ")]))));
  }, [motor, estado.versao, config.exibirDadosCliente]);

  const r = rotuloSync(estado);
  const recusadas = fila.filter((o) => o.estado === "erro");
  const aEnviar = fila.filter((o) => o.estado === "pendente");

  async function sair() {
    if (estado.pendentes && !(await confirmar({
      titulo: "Sair com gravações no aparelho?",
      mensagem: `Há ${estado.pendentes} gravação(ões) no aparelho. Ficam guardadas e sobem na próxima entrada neste celular.`,
      confirmarTexto: "Sair mesmo assim", cancelarTexto: "Ficar",
    }))) return;
    await signOut({ callbackUrl: "/login" });
  }

  return (
    <div className="space-y-5" data-vista="perfil">
      <header className="flex items-center gap-3">
        <span data-avatar-perfil data-com-foto={avatar ? "" : undefined}><AvatarTecnico nome={usuario.nome} fotoUrl={avatar} size={48} /></span>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ink truncate">{usuario.nome}</h1>
          <p className="text-sm text-ink-muted truncate">{usuario.email} · {usuario.empresaNome}</p>
        </div>
      </header>

      <section className="bg-white rounded-card border border-surface-border p-4 space-y-3" data-painel-sync>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold text-ink">Sincronização</h2>
          <span className={cn("text-xs font-semibold rounded-full px-2.5 py-1", r.classe)}>{r.texto}</span>
        </div>
        <p className="text-sm text-ink-muted">{r.detalhe}.{estado.ultimoSync ? ` Última sincronização às ${horaBR(estado.ultimoSync)}.` : ""}</p>
        <p className="text-sm text-ink">{aEnviar.length ? `${aEnviar.length} gravação(ões) a enviar.` : "Nada esperando para enviar."}</p>
        {/* O navegador não protegeu o armazenamento e há coisa guardada: a dica que evita perder */}
        {armazenamento === "comum" && aEnviar.length > 0 && (
          <p className="text-xs text-ink-muted" data-armazenamento-comum>Instale o app na tela inicial para o navegador não limpar o que está guardado.</p>
        )}
        <button type="button" disabled={!motor || sincronizando} data-sincronizar
          onClick={async () => { setSincronizando(true); await motor!.tentarDeNovo(); setSincronizando(false); }}
          className="w-full rounded-card bg-primary-600 text-white py-3 font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 touch-target">
          <RefreshCw className={cn("w-4 h-4", sincronizando && "animate-spin")} /> Sincronizar agora
        </button>
        {recusadas.length > 0 && (
          <div className="space-y-2" data-recusadas>
            <p className="text-sm font-semibold text-atrasado-texto inline-flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Recusadas pelo escritório (continuam guardadas)</p>
            <ul className="space-y-2">
              {recusadas.map((o) => (
                <li key={o.seq} className="rounded-card border border-atrasado/20 bg-atrasado-claro p-3 text-sm space-y-1">
                  <p className="font-semibold text-ink">{ROTULO_OPERACAO[o.tipo] ?? o.tipo}{osDe[o.atividadeId] ? ` — ${osDe[o.atividadeId]}` : ""}</p>
                  <p className="text-atrasado-texto">{o.erro}</p>
                  {o.tipo === "scan"
                    ? <p className="text-xs text-ink-muted">O resto do serviço desta OS sobe normalmente.</p>
                    : <p className="text-xs text-ink-muted">As próximas gravações desta OS esperam esta. Reaberta pelo escritório? Toque em “Sincronizar agora”.</p>}
                  <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-atrasado-texto py-1"
                    onClick={async () => { if (await confirmar({ mensagem: "Descartar esta gravação? Ela não vai para o escritório.", perigo: true, confirmarTexto: "Descartar" })) await motor?.descartar(o.seq!); }}>
                    <Trash2 className="w-3.5 h-3.5" /> Descartar esta
                  </button>
                  {(() => {
                    // OS cancelada (ou que saiu dele) com trabalho feito sem sinal: as que esperam esta não têm mais para onde ir
                    const esperam = o.tipo === "scan" ? 0 : aEnviar.filter((q) => q.atividadeId === o.atividadeId && q.seq! > o.seq!).length;
                    if (!esperam) return null;
                    return (
                      <button type="button" className="ml-3 inline-flex items-center gap-1 text-xs font-semibold text-atrasado-texto py-1" data-descartar-da-os
                        onClick={async () => { if (await confirmar({ mensagem: `Descartar esta e as ${esperam} que esperam por ela nesta OS? Nada disso vai para o escritório.`, perigo: true, confirmarTexto: "Descartar todas" })) await motor?.descartarDaAtividade(o.atividadeId); }}>
                        <Trash2 className="w-3.5 h-3.5" /> Descartar todas desta OS ({esperam + 1})
                      </button>
                    );
                  })()}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Notificações com o app fechado (leva push; o bloco mora em components/push) */}
      <NotificacoesAparelho modo="app" />

      {config.lancarDespesas && (
        <button type="button" onClick={() => irPara({ ver: "despesas" })} data-minhas-despesas
          className="w-full flex items-center gap-3 bg-white rounded-card border border-surface-border p-4 font-semibold text-ink touch-target">
          <Receipt className="w-5 h-5 text-ink-muted" /> Minhas despesas
        </button>
      )}

      {usaComissao && (
        <section className="bg-white rounded-card border border-surface-border" data-comissoes-app>
          <button type="button" onClick={() => setComissoesAbertas((v) => !v)} aria-expanded={comissoesAbertas}
            className="w-full flex items-center justify-between p-4 font-semibold text-ink touch-target">
            <span className="flex items-center gap-3"><Percent className="w-5 h-5 text-ink-muted" /> Minhas comissões</span>
            <ChevronDown className={cn("w-5 h-5 transition-transform", comissoesAbertas && "rotate-180")} />
          </button>
          {comissoesAbertas && <div className="border-t border-surface-border p-3"><MinhasComissoes /></div>}
        </section>
      )}

      <a href="/veiculos/checklist" className="flex items-center gap-3 bg-white rounded-card border border-surface-border p-4 font-semibold text-ink touch-target">
        <Car className="w-5 h-5 text-ink-muted" /> Checklist do veículo
      </a>

      <section className="bg-white rounded-card border border-surface-border">
        <button type="button" onClick={() => setDados((v) => !v)} aria-expanded={dados} className="w-full flex items-center justify-between p-4 font-semibold text-ink touch-target">
          Meus dados <ChevronDown className={cn("w-5 h-5 transition-transform", dados && "rotate-180")} />
        </button>
        {dados && (
          // No app, tudo o que se toca em "Meus dados" tem pelo menos 44 px (a tela do painel é mais compacta)
          <div className="border-t border-surface-border p-2 [&_button]:min-h-[44px] [&_input]:min-h-[44px]" data-meus-dados-app>
            {/* emailSomenteLeitura: o técnico não troca o próprio e-mail de login (perderia as OS dele) */}
            <PerfilClient initial={{ ...perfilInicial, avatar }} onAvatar={definirAvatar} emailSomenteLeitura semComissoes />
            {/* Preferência do aparelho (não é ação do dia a dia): fica aqui, fora da frente do Perfil */}
            <PreferenciaRota />
          </div>
        )}
      </section>

      <button type="button" onClick={sair} className="w-full rounded-card border border-atrasado/20 bg-white text-atrasado py-3 font-semibold inline-flex items-center justify-center gap-2 touch-target">
        <LogOut className="w-4 h-4" /> Sair
      </button>
    </div>
  );
}
