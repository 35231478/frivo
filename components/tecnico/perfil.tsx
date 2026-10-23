"use client";

import { confirmar } from "@/components/ui/avisos";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { AlertTriangle, Car, ChevronDown, LogOut, RefreshCw, Trash2, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { PerfilClient } from "@/components/perfil/perfil-client";
import { rotuloSync } from "@/components/tecnico/indicador-sync";
import { useTecnico } from "@/components/tecnico/contexto";
import type { OperacaoFila } from "@/lib/tecnico/offline/tipos";

const ROTULO_OPERACAO: Record<string, string> = {
  iniciar: "Início do atendimento", resposta: "Resposta do checklist", audio: "Observação em áudio", tudoOk: "TUDO OK",
  foto: "Foto", fotoRemover: "Foto retirada", equipamento: "Equipamento atendido/observação", formulario: "Formulário",
  vincular: "Equipamento vinculado", scan: "QR Code lido", adicional: "Serviço extra", adicionalRemover: "Serviço extra retirado",
  adicionalFoto: "Foto do serviço extra", adicionalFotoRemover: "Foto do serviço extra retirada", concluir: "Conclusão da atividade",
};

/** Perfil do técnico: situação da sincronização (com o motivo das recusadas), dados, checklist do veículo, sair. */
export function PerfilTecnico({ perfilInicial }: { perfilInicial: React.ComponentProps<typeof PerfilClient>["initial"] }) {
  const { motor, estado, usuario } = useTecnico();
  const [fila, setFila] = useState<OperacaoFila[]>([]);
  const [osDe, setOsDe] = useState<Record<string, string>>({});
  const [dados, setDados] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  useEffect(() => {
    if (!motor) return;
    motor.banco.fila().then(setFila);
    motor.banco.retratos().then((rs) => setOsDe(Object.fromEntries(rs.map((r) => [r.atividadeId, `${r.retrato.cartao.osNumero} · ${r.retrato.cartao.cliente}`]))));
  }, [motor, estado.versao]);

  const r = rotuloSync(estado);
  const recusadas = fila.filter((o) => o.estado === "erro");
  const aEnviar = fila.filter((o) => o.estado === "pendente");

  async function sair() {
    if (estado.pendentes && !(await confirmar({
      titulo: "Sair com gravações no aparelho?",
      mensagem: `Há ${estado.pendentes} gravação(ões) ainda no aparelho. Elas continuam guardadas e sobem quando você entrar de novo neste celular.`,
      confirmarTexto: "Sair mesmo assim", cancelarTexto: "Ficar",
    }))) return;
    await signOut({ callbackUrl: "/login" });
  }

  return (
    <div className="space-y-5" data-vista="perfil">
      <header className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center"><UserRound className="w-6 h-6" /></div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ink truncate">{usuario.nome}</h1>
          <p className="text-sm text-ink-muted truncate">{usuario.email} · {usuario.empresaNome}</p>
        </div>
      </header>

      <section className="bg-white rounded-2xl border border-surface-border p-4 space-y-3" data-painel-sync>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold text-ink">Sincronização</h2>
          <span className={cn("text-xs font-semibold rounded-full px-2.5 py-1", r.classe)}>{r.texto}</span>
        </div>
        <p className="text-sm text-ink-muted">{r.detalhe}.{estado.ultimoSync ? ` Última sincronização às ${new Date(estado.ultimoSync).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.` : ""}</p>
        <p className="text-sm text-ink">{aEnviar.length ? `${aEnviar.length} gravação(ões) a enviar.` : "Nada esperando para enviar."}</p>
        <button type="button" disabled={!motor || sincronizando} data-sincronizar
          onClick={async () => { setSincronizando(true); await motor!.tentarDeNovo(); setSincronizando(false); }}
          className="w-full rounded-xl bg-primary-600 text-white py-3 font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 touch-target">
          <RefreshCw className={cn("w-4 h-4", sincronizando && "animate-spin")} /> Sincronizar agora
        </button>
        {recusadas.length > 0 && (
          <div className="space-y-2" data-recusadas>
            <p className="text-sm font-semibold text-red-700 inline-flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Recusadas pelo escritório (continuam guardadas)</p>
            <ul className="space-y-2">
              {recusadas.map((o) => (
                <li key={o.seq} className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm space-y-1">
                  <p className="font-semibold text-ink">{ROTULO_OPERACAO[o.tipo] ?? o.tipo}{osDe[o.atividadeId] ? ` — ${osDe[o.atividadeId]}` : ""}</p>
                  <p className="text-red-800">{o.erro}</p>
                  <p className="text-xs text-ink-muted">As gravações seguintes desta OS esperam esta ser resolvida. Se o escritório reabriu a atividade, toque em “Sincronizar agora”.</p>
                  <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 py-1"
                    onClick={async () => { if (await confirmar({ mensagem: "Descartar esta gravação? Ela não vai para o escritório.", perigo: true, confirmarTexto: "Descartar" })) await motor?.descartar(o.seq!); }}>
                    <Trash2 className="w-3.5 h-3.5" /> Descartar esta
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <a href="/veiculos/checklist" className="flex items-center gap-3 bg-white rounded-2xl border border-surface-border p-4 font-semibold text-ink touch-target">
        <Car className="w-5 h-5 text-ink-muted" /> Checklist do veículo
      </a>

      <section className="bg-white rounded-2xl border border-surface-border">
        <button type="button" onClick={() => setDados((v) => !v)} aria-expanded={dados} className="w-full flex items-center justify-between p-4 font-semibold text-ink touch-target">
          Meus dados e senha <ChevronDown className={cn("w-5 h-5 transition-transform", dados && "rotate-180")} />
        </button>
        {dados && <div className="border-t border-surface-border p-2"><PerfilClient initial={perfilInicial} /></div>}
      </section>

      <button type="button" onClick={sair} className="w-full rounded-2xl border border-red-200 bg-white text-red-600 py-3 font-semibold inline-flex items-center justify-center gap-2 touch-target">
        <LogOut className="w-4 h-4" /> Sair
      </button>
    </div>
  );
}
