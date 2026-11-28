"use client";

/**
 * Checklist de veículo OBRIGATÓRIO no app — o "porteiro". Nos dias de checklist, a única tela do colaborador com
 * veículo padrão é o checklist do veículo (tela cheia, sem a navegação); feito — ou "Hoje não vou usar o veículo" —,
 * o resto do app libera até o próximo dia de checklist.
 *
 * Offline: o formulário funciona sem sinal (o modelo e o veículo vêm na cópia da página guardada no aparelho). O
 * registro é guardado no aparelho e LIBERA na hora; o envio sobe sozinho quando o sinal volta (lib/checklist-diario/
 * aparelho). Nunca prende: qualquer erro do porteiro libera.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CarFront, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/avisos";
import { ItensChecklist } from "@/components/veiculos/itens-checklist";
import { useTecnico } from "@/components/tecnico/contexto";
import { reduzirImagem } from "@/lib/imagem-cliente";
import { novoId } from "@/lib/tecnico/offline/motor";
import { itemGeraAlerta, primeiroObrigatorioFaltando, type RespostaDoItem } from "@/lib/veiculos/checklist";
import { hojeBR, MAX_MOTIVO, NOMES_DIAS, diaDaSemana, porteiroAberto, type ResumoPorteiro, type SituacaoDiario } from "@/lib/checklist-diario/regras";
import { FilaDiario, armazemDoBanco, armazemNaMemoria, situacaoLocal, type Guardado } from "@/lib/checklist-diario/aparelho";
import type { EnvioDiario } from "@/lib/checklist-diario/envio";

export interface EstadoPorteiro {
  /** O porteiro aparece agora (o resto do app fica atrás dele) */
  aberto: boolean;
  /** Ainda lendo o que o aparelho guardou (não trava nem libera às cegas por um instante) */
  carregando: boolean;
  hoje: string;
  /** Situação de hoje (servidor ou aparelho): "não vou usar" mostra o atalho para fazer o checklist */
  situacaoHoje: SituacaoDiario | null;
  /** Último envio recusado pelo servidor (Perfil) */
  erro: string | null;
  registrar: (envio: EnvioDiario) => Promise<void>;
  /** "Fazer checklist do veículo" depois do "não vou usar": reabre o formulário */
  reabrir: () => void;
  fechar: () => void;
}

/** Liga o porteiro ao aparelho: lê o que foi guardado, decide se abre, envia a fila quando há sinal. */
export function usePorteiro(resumo: ResumoPorteiro | null | undefined, opcoes: { fila?: FilaDiario; agora?: () => number } = {}): EstadoPorteiro {
  const { motor, semBanco } = useTecnico();
  const agora = opcoes.agora ?? Date.now;
  const fila = useMemo(() => opcoes.fila ?? (motor ? new FilaDiario(armazemDoBanco(motor.banco)) : semBanco ? new FilaDiario(armazemNaMemoria()) : null),
    [opcoes.fila, motor, semBanco]);
  const [guardado, setGuardado] = useState<Guardado | null>(null);
  const [hoje, setHoje] = useState(() => hojeBR(agora()));
  const [reaberto, setReaberto] = useState(false);

  // A virada do dia com o app aberto: o porteiro do próximo dia aparece sem recarregar
  useEffect(() => {
    const t = setInterval(() => setHoje(hojeBR(agora())), 60_000);
    return () => clearInterval(t);
  }, [agora]);

  useEffect(() => {
    if (!fila || !resumo) return;
    let vivo = true;
    fila.ler().then((g) => { if (vivo) setGuardado(g); }).catch(() => { if (vivo) setGuardado({ pendentes: [], registros: [], erro: null }); });
    const subir = () => { void fila.enviar().then(() => fila.ler()).then((g) => { if (vivo) setGuardado(g); }).catch(() => {}); };
    subir();
    window.addEventListener("online", subir);
    const t = setInterval(subir, 60_000);
    return () => { vivo = false; window.removeEventListener("online", subir); clearInterval(t); };
  }, [fila, resumo]);

  const registrar = useCallback(async (envio: EnvioDiario) => {
    if (!fila) return;
    try {
      setGuardado(await fila.registrar(envio));
      // Depois do envio (subiu, ficou para depois ou foi recusado), a tela mostra o que ficou guardado
      void fila.enviar().then(() => fila.ler()).then(setGuardado).catch(() => {});
    } catch { /* nunca prende: segue liberado */ setGuardado((g) => ({ ...(g ?? { pendentes: [], erro: null }), registros: [...(g?.registros ?? []), { dia: envio.dia, situacao: envio.situacao }] })); }
    setReaberto(false);
  }, [fila]);

  const local = guardado ? situacaoLocal(guardado, hoje) : null;
  const servidor = resumo?.registro?.dia === hoje ? resumo.registro.situacao : null;
  const situacaoHoje: SituacaoDiario | null = local === "FEITO" || servidor === "FEITO" ? "FEITO" : local ?? servidor;
  // Enquanto o banco do aparelho abre (ou a fila é lida), nem trava nem libera às cegas; sem banco, segue sem esperar
  const carregando = !!resumo && !guardado && (fila ? true : !semBanco);
  const abertoPelaRegra = !!resumo && porteiroAberto(resumo, hoje, guardado?.registros.map((r) => r.dia) ?? []);
  return {
    aberto: !carregando && (abertoPelaRegra || (reaberto && situacaoHoje === "NAO_VAI_USAR")),
    carregando, hoje, situacaoHoje, erro: guardado?.erro ?? null,
    registrar, reabrir: () => setReaberto(true), fechar: () => setReaberto(false),
  };
}

const dataPorExtenso = (dia: string) => `${NOMES_DIAS[diaDaSemana(dia)]}, ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const reduzir = async (arquivo: File) => (await reduzirImagem(arquivo, 1280, 0.8)).imagem.dataUrl;

/** A tela cheia do porteiro: o checklist do veículo padrão e a saída honesta "Hoje não vou usar o veículo". */
export function PorteiroChecklist({ resumo, porteiro, trocando = false }: { resumo: ResumoPorteiro; porteiro: EstadoPorteiro; trocando?: boolean }) {
  const [respostas, setRespostas] = useState<Record<string, RespostaDoItem>>({});
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [naoVou, setNaoVou] = useState(false);
  const [motivo, setMotivo] = useState("");
  const { modelo, veiculo } = resumo;

  const base = () => ({ clientId: novoId(), dia: porteiro.hoje, feitoEm: new Date().toISOString(), veiculoId: veiculo.id });

  async function enviar() {
    setErro("");
    const falta = primeiroObrigatorioFaltando(modelo.itens, respostas);
    if (falta) { setErro(falta); return; }
    setSalvando(true);
    try {
      const itens = modelo.itens.filter((it) => respostas[it.id]?.valor || respostas[it.id]?.foto)
        .map((it) => ({ itemTemplateId: it.id, valor: respostas[it.id]?.valor ?? null, foto: respostas[it.id]?.foto ?? null }));
      const comAlerta = modelo.itens.some((it) => itemGeraAlerta(it, respostas[it.id]?.valor ?? null));
      await porteiro.registrar({ ...base(), situacao: "FEITO", templateId: modelo.id, itens, observacaoGeral: observacao.trim() || null });
      const semSinal = typeof navigator !== "undefined" && navigator.onLine === false;
      toast(comAlerta ? "Checklist registrado com alertas. O gestor vai ver os itens com problema." : "Checklist registrado.");
      if (semSinal) toast("Sem sinal agora: o checklist ficou no aparelho e sobe sozinho quando o sinal voltar.", "info");
    } finally { setSalvando(false); }
  }

  async function naoVouUsar() {
    setSalvando(true);
    try {
      await porteiro.registrar({ ...base(), situacao: "NAO_VAI_USAR", motivo: motivo.trim() || null });
      toast("Registrado: hoje sem o veículo. O gestor vai ver.");
    } finally { setSalvando(false); }
  }

  return (
    <section className="space-y-4" aria-label="Checklist do veículo" data-porteiro>
      <header className="bg-white rounded-card border border-surface-border p-4 space-y-2">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-acento">
          <ClipboardCheck className="w-4 h-4" aria-hidden /> Checklist do veículo · {dataPorExtenso(porteiro.hoje)}
        </p>
        <h1 className="flex items-center gap-2 text-lg font-bold text-ink" data-porteiro-veiculo>
          <CarFront className="w-5 h-5 text-ink-muted shrink-0" aria-hidden /> <span className="font-mono">{veiculo.placa}</span> <span className="font-medium text-ink-muted truncate">· {veiculo.modelo}</span>
        </h1>
        <p className="text-sm text-ink-muted">
          {trocando ? "Vai usar o veículo, afinal? Faça o checklist: ele substitui o “não vou usar” de hoje." : "Antes de começar o dia, confira o veículo. Feito o checklist, o app libera até o próximo dia de checklist."}
        </p>
      </header>

      {erro && (
        <div role="alert" className="flex items-center gap-2 bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-3" data-erro-porteiro>
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden /> {erro}
        </div>
      )}

      <ItensChecklist itens={modelo.itens} respostas={respostas} onErro={setErro} reduzirFoto={reduzir}
        onResposta={(itemId, r) => { setErro(""); setRespostas((p) => ({ ...p, [itemId]: r })); }} />

      <div className="bg-white rounded-card border border-surface-border p-4 space-y-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-ink">Observação (opcional)</span>
          <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} maxLength={2000} placeholder="Algo mais sobre o veículo" data-porteiro-observacao />
        </label>
        <Button type="button" className="w-full justify-center" size="lg" loading={salvando && !naoVou} onClick={enviar} data-porteiro-enviar>Enviar checklist</Button>
      </div>

      {trocando ? (
        <div className="text-center">
          <button type="button" onClick={porteiro.fechar} className="text-sm text-ink-muted underline underline-offset-2 py-2 min-h-[44px] px-2" data-porteiro-voltar>Voltar sem fazer o checklist</button>
        </div>
      ) : !naoVou ? (
        <div className="text-center">
          <button type="button" onClick={() => setNaoVou(true)} className="text-sm text-ink-muted underline underline-offset-2 py-2 min-h-[44px] px-2" data-porteiro-nao-vou>Hoje não vou usar o veículo</button>
        </div>
      ) : (
        <div className="bg-white rounded-card border border-surface-border p-4 space-y-3" data-porteiro-nao-vou-caixa>
          <p className="text-sm text-ink">Sem o veículo hoje? O app libera e o gestor fica sabendo.</p>
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={MAX_MOTIVO} placeholder="Motivo (opcional): carona, serviço a pé, veículo na oficina…" data-porteiro-motivo />
          <div className="flex flex-wrap gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={() => setNaoVou(false)}>Voltar</Button>
            <Button type="button" variant="secondary" loading={salvando && naoVou} onClick={naoVouUsar} data-porteiro-confirmar-nao-vou>Confirmar: não vou usar</Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** No Meu dia, depois do "não vou usar": o atalho discreto para fazer o checklist mesmo assim */
export function AtalhoChecklist({ porteiro }: { porteiro: EstadoPorteiro }) {
  if (porteiro.situacaoHoje !== "NAO_VAI_USAR") return null;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-surface-border bg-white px-3 py-2 text-sm" data-atalho-checklist>
      <span className="text-ink-muted">Hoje: sem o veículo.</span>
      <button type="button" onClick={porteiro.reabrir} className="font-semibold text-acento underline underline-offset-2" data-fazer-checklist>Fazer checklist do veículo</button>
    </div>
  );
}
