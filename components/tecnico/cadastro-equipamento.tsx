"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, QrCode, ScanLine, WifiOff, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/avisos";
import { ScannerQR } from "@/components/os/scanner-qr";
import { BotaoFoto, Miniatura } from "@/components/tecnico/captura";
import { irPara, useTecnico } from "@/components/tecnico/contexto";
import { equipamentoDoQr } from "@/lib/tecnico/offline/estado";
import { novoId } from "@/lib/tecnico/offline/motor";
import {
  MSG_SEM_SINAL_SERIE, MSG_TIPO_OBRIGATORIO, SERIE_MIN, UNIDADES_CAPACIDADE, apresentarCadastro, montarCapacidade, seriesNoAparelho,
  type CadastroEquipamento, type SerieNoAparelho, type TipoCadastro,
} from "@/lib/tecnico/cadastro-equipamento";
import type { EquipamentoUnidade, ExecucaoTela, NovaOperacao, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

const campo = "w-full rounded-card border border-surface-border bg-white px-3 py-3 text-base text-ink";
const rotulo = "text-sm font-semibold text-ink";
const semSinal = () => typeof navigator !== "undefined" && !navigator.onLine;

type SerieServidor = { doCliente: { id: string; titulo: string; fabricante: string; local: string | null; ativo: boolean }[]; outrosClientes: number };

/**
 * Aviso de nº de série repetido no cadastro em campo — SÓ aviso, nunca trava.
 *  - Na hora, sem depender de sinal: confere o que o aparelho já tem (equipamentos da unidade e os
 *    cadastros na fila esperando sincronizar).
 *  - Com sinal: confere também a empresa inteira (o servidor não diz nome de outro cliente).
 *  - Sem sinal: diz que a conferência completa acontece ao sincronizar.
 */
function AvisoSerieCampo({ numero, atividadeId, ignorarId, daUnidade, tipos, naOs, onVincular }: {
  numero: string; atividadeId: string; ignorarId: string; daUnidade: EquipamentoUnidade[]; tipos: readonly TipoCadastro[]; naOs: Set<string>; onVincular: (id: string) => void;
}) {
  const { motor, estado } = useTecnico();
  const [naFila, setNaFila] = useState<{ id: string; titulo: string; local: string | null; numeroSerie: string | null }[]>([]);
  const [servidor, setServidor] = useState<SerieServidor | null>(null);
  const [offline, setOffline] = useState(false);
  const n = numero.trim();

  // Cadastros que estão na fila do aparelho (de qualquer OS), ainda sem conferência do servidor
  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    motor.banco.fila().then((ops) => {
      if (!vivo) return;
      setNaFila(ops.flatMap((o) => {
        if (o.tipo !== "cadastrarEquipamento") return [];
        const e = apresentarCadastro(o.dados, tipos);
        return [{ id: e.id, titulo: [e.titulo, e.fabricante].filter(Boolean).join(" · "), local: e.local, numeroSerie: e.numeroSerie }];
      }));
    }).catch(() => {});
    return () => { vivo = false; };
  }, [motor, estado.versao, tipos]);

  // Conferência completa, só com sinal
  useEffect(() => {
    setServidor(null);
    if (n.length < SERIE_MIN) { setOffline(false); return; }
    if (semSinal()) { setOffline(true); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ numero: n, ignorar: ignorarId });
      fetch(`/api/tecnico/atividades/${atividadeId}/serie?${qs}`, { signal: ctrl.signal, cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("recusada"))))
        .then((d: SerieServidor) => { setServidor({ doCliente: Array.isArray(d?.doCliente) ? d.doCliente : [], outrosClientes: Number(d?.outrosClientes) || 0 }); setOffline(false); })
        .catch((e) => { if ((e as { name?: string })?.name !== "AbortError") setOffline(true); });
    }, 400);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [n, atividadeId, ignorarId]);

  const locais: SerieNoAparelho[] = useMemo(() => seriesNoAparelho(n, daUnidade, naFila, ignorarId), [n, daUnidade, naFila, ignorarId]);
  const idsLocais = new Set(locais.map((l) => l.id));
  const doServidor = (servidor?.doCliente ?? []).filter((d) => !idsLocais.has(d.id));
  const outros = servidor?.outrosClientes ?? 0;
  const achou = locais.length + doServidor.length + outros > 0;
  if (!achou && !offline) return null;

  return (
    <div className="space-y-2" data-aviso-serie-campo>
      {achou && (
        <div role="status" className="rounded-card border border-atencao/20 bg-atencao-claro px-3 py-2 text-sm text-atencao-texto space-y-1.5" data-serie-repetida>
          <p className="flex items-start gap-2 font-semibold"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> Este nº de série já existe. Confira se não é o mesmo equipamento.</p>
          <ul className="space-y-1.5">
            {locais.map((l) => (
              <li key={l.id} data-serie-origem={l.origem}>
                <span className="block">{[l.titulo, l.local].filter(Boolean).join(" — ")}{l.origem === "fila" ? " (cadastrado neste aparelho)" : naOs.has(l.id) ? " (já está nesta OS)" : ""}</span>
                {l.origem === "unidade" && !naOs.has(l.id) && (
                  <button type="button" onClick={() => onVincular(l.id)} data-vincular-existente={l.id}
                    className="mt-1 inline-flex items-center rounded-card border border-atencao/40 bg-white px-3 text-sm font-semibold text-ink touch-target">Vincular este à OS</button>
                )}
              </li>
            ))}
            {doServidor.map((d) => <li key={d.id}>{[d.titulo, d.fabricante, d.local].filter(Boolean).join(" — ")}{d.ativo ? "" : " (inativo)"}</li>)}
            {outros > 0 && <li data-serie-outro-cliente>{outros === 1 ? "Existe em um equipamento de outro cliente." : `Existe em ${outros} equipamentos de outros clientes.`}</li>}
          </ul>
          <p>Apenas um aviso: é possível salvar assim mesmo.</p>
        </div>
      )}
      {offline && <p className="flex items-start gap-2 text-xs text-ink-muted" data-serie-sem-sinal><WifiOff className="w-4 h-4 shrink-0" /> {MSG_SEM_SINAL_SERIE}</p>}
    </div>
  );
}

/**
 * Cadastro de equipamento EM CAMPO, dentro da OS: para o equipamento que não está na unidade (nem
 * pelo QR, nem na lista). Enxuto, de dedão — cliente e unidade vêm da OS, não se pede de novo. Ao
 * salvar, o equipamento já fica vinculado à atividade e o técnico segue a execução nele. Funciona
 * sem sinal: fica na fila do aparelho e sobe sozinho.
 */
export function ModalCadastroEquipamento({ r, x, endereco, onFechar, registrar }: {
  r: RetratoAtividade; x: ExecucaoTela; /** Endereço da OS para a marca d'água */ endereco?: string | null;
  onFechar: () => void; registrar: (ops: NovaOperacao[]) => Promise<void>;
}) {
  const atividadeId = x.atividade.id;
  const cadastro = r.cadastro;
  const tipos = useMemo(() => cadastro?.tipos ?? [], [cadastro]);
  const [id] = useState(() => novoId());
  const [tipo, setTipo] = useState("");
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [serie, setSerie] = useState("");
  const [capacidade, setCapacidade] = useState("");
  const [unidadeCap, setUnidadeCap] = useState<string>(UNIDADES_CAPACIDADE[0]);
  const [setor, setSetor] = useState("");
  const [ambiente, setAmbiente] = useState("");
  const [fotoEquip, setFotoEquip] = useState<string | null>(null);
  const [fotoEtiqueta, setFotoEtiqueta] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const [leitura, setLeitura] = useState<{ tipo: "ok" | "aviso"; texto: string } | null>(null);
  const [scan, setScan] = useState(false);
  const [qrLido, setQrLido] = useState<string | null>(null);
  const [qrDeOutro, setQrDeOutro] = useState<EquipamentoUnidade | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const marcaFoto = { osNumero: x.os.numero, endereco };
  const naOs = useMemo(() => new Set(x.equipamentos.map((e) => e.equipamento.id)), [x.equipamentos]);

  async function vincularExistente(equipamentoId: string) {
    await registrar([{ tipo: "vincular", atividadeId, equipamentoIds: [equipamentoId] }]);
    toast("Equipamento vinculado à OS.");
    onFechar();
    irPara({ ver: "os", a: atividadeId, e: equipamentoId });
  }

  /** Etiqueta fotografada: guarda a foto e, COM sinal, lê os dados para conferir. Sem sinal, digita-se. */
  async function aoFotografarEtiqueta(dataUrl: string) {
    setFotoEtiqueta(dataUrl); setLeitura(null);
    if (semSinal()) { setLeitura({ tipo: "aviso", texto: "Sem sinal: digite os dados da etiqueta." }); return; }
    setLendo(true);
    try {
      const res = await fetch(`/api/tecnico/atividades/${atividadeId}/etiqueta`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imagem: dataUrl }) });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.legivel) { setLeitura({ tipo: "aviso", texto: "Não deu para ler a etiqueta: digite os dados." }); return; }
      const c = (d.campos ?? {}) as Record<string, unknown>;
      const lido = (k: string) => (typeof c[k] === "string" ? (c[k] as string).trim() : "");
      // Só preenche o que está vazio: o que o técnico já digitou vale
      let n = 0;
      const por = (atual: string, novo: string, set: (v: string) => void) => { if (!atual.trim() && novo) { set(novo); n++; } };
      por(serie, lido("numero_serie"), setSerie);
      por(marca, lido("marca"), setMarca);
      por(modelo, lido("modelo"), setModelo);
      por(capacidade, lido("capacidade_valor"), setCapacidade);
      if (!capacidade.trim() && UNIDADES_CAPACIDADE.includes(lido("capacidade_unidade") as never)) setUnidadeCap(lido("capacidade_unidade"));
      if (!tipo && tipos.some((t) => t.valor === lido("tipo"))) { setTipo(lido("tipo")); n++; }
      setLeitura(n ? { tipo: "ok", texto: "Lido da etiqueta: confira os campos." } : { tipo: "aviso", texto: "Nada foi lido da etiqueta: digite os dados." });
    } catch {
      setLeitura({ tipo: "aviso", texto: "Sem sinal: digite os dados da etiqueta." });
    } finally { setLendo(false); }
  }

  function aoLerQr(valor: string) {
    setScan(false);
    const existente = equipamentoDoQr(r, valor);
    if (existente) { setQrDeOutro(existente); setQrLido(null); return; }
    setQrDeOutro(null); setQrLido(valor.trim());
  }

  async function salvar() {
    if (!tipo) { setErro(MSG_TIPO_OBRIGATORIO); return; }
    setErro(""); setSalvando(true);
    const ou = (v: string) => v.trim() || undefined;
    const fotos = [fotoEquip, fotoEtiqueta].filter((f): f is string => !!f);
    const dados: CadastroEquipamento = {
      id, tipo, marca: ou(marca), modelo: ou(modelo), numeroSerie: ou(serie), capacidade: montarCapacidade(capacidade, unidadeCap),
      setor: ou(setor), ambiente: ou(ambiente), ...(fotos.length && { fotos }), ...(qrLido && { qrLido }),
    };
    try {
      await registrar([{ tipo: "cadastrarEquipamento", atividadeId, dados }]);
      toast(semSinal() ? "Equipamento guardado no aparelho: sobe sozinho quando houver sinal." : "Equipamento cadastrado e vinculado à OS.");
      onFechar();
      irPara({ ver: "os", a: atividadeId, e: id });
    } catch { setSalvando(false); }
  }

  return (
    <Modal aberto titulo="Novo equipamento" onFechar={onFechar}>
      <div className="space-y-4" data-modal-cadastro-equipamento>
        <p className="text-sm text-ink-muted">Fica nesta unidade, já vinculado a esta OS.</p>

        <label className="block space-y-1">
          <span className={rotulo}>Tipo de equipamento <span className="text-atrasado">*</span></span>
          <select value={tipo} onChange={(e) => { setTipo(e.target.value); setErro(""); }} aria-label="Tipo de equipamento" data-tipo className={campo}>
            <option value="">Escolha…</option>
            {tipos.map((t) => <option key={t.valor} value={t.valor}>{t.nome}</option>)}
          </select>
        </label>

        <div className="space-y-2">
          <span className={rotulo}>Etiqueta do equipamento</span>
          {fotoEtiqueta
            ? <Miniatura src={fotoEtiqueta} alt="foto da etiqueta" pendente onRemover={() => { setFotoEtiqueta(null); setLeitura(null); }} />
            : <BotaoFoto grande rotulo="Fotografar a etiqueta" marca={marcaFoto} onFoto={aoFotografarEtiqueta} />}
          {lendo && <p className="flex items-center gap-2 text-sm text-ink-muted" data-lendo-etiqueta><Loader2 className="w-4 h-4 animate-spin" /> Lendo a etiqueta…</p>}
          {leitura && <p role="status" data-leitura={leitura.tipo} className={leitura.tipo === "ok" ? "text-sm text-success-800" : "text-sm text-atencao-texto"}>{leitura.texto}</p>}
          <p className="text-xs text-ink-muted" data-aviso-privacidade>Com sinal, a foto da etiqueta é enviada à Anthropic (IA) só para ler o texto.</p>
        </div>

        <label className="block space-y-1">
          <span className={rotulo}>Nº de série <span className="font-normal text-ink-muted">(recomendado)</span></span>
          <input value={serie} onChange={(e) => setSerie(e.target.value)} maxLength={80} aria-label="Número de série" data-serie placeholder="Como está na etiqueta" autoCapitalize="characters" className={campo} />
        </label>
        <AvisoSerieCampo numero={serie} atividadeId={atividadeId} ignorarId={id} daUnidade={r.equipamentosUnidade} tipos={tipos} naOs={naOs} onVincular={vincularExistente} />

        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className={rotulo}>Marca</span>
            <input value={marca} onChange={(e) => setMarca(e.target.value)} maxLength={80} aria-label="Marca" data-marca placeholder="Ex.: LG" className={campo} />
          </label>
          <label className="block space-y-1">
            <span className={rotulo}>Modelo</span>
            <input value={modelo} onChange={(e) => setModelo(e.target.value)} maxLength={120} aria-label="Modelo" data-modelo className={campo} />
          </label>
        </div>

        <div className="space-y-1">
          <span className={rotulo}>Capacidade</span>
          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <input value={capacidade} onChange={(e) => setCapacidade(e.target.value.replace(/[^\d.,]/g, ""))} maxLength={12} inputMode="decimal" aria-label="Capacidade" data-capacidade placeholder="Ex.: 12000" className={campo} />
            <select value={unidadeCap} onChange={(e) => setUnidadeCap(e.target.value)} aria-label="Unidade da capacidade" className={campo}>
              {UNIDADES_CAPACIDADE.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className={rotulo}>Setor</span>
            <input value={setor} onChange={(e) => setSetor(e.target.value)} maxLength={80} list="cadastro-setores" aria-label="Setor" data-setor placeholder="Ex.: 2º andar" className={campo} />
          </label>
          <label className="block space-y-1">
            <span className={rotulo}>Ambiente</span>
            <input value={ambiente} onChange={(e) => setAmbiente(e.target.value)} maxLength={80} list="cadastro-ambientes" aria-label="Ambiente" data-ambiente placeholder="Ex.: Sala 201" className={campo} />
          </label>
          <datalist id="cadastro-setores">{(cadastro?.setores ?? []).map((s) => <option key={s} value={s} />)}</datalist>
          <datalist id="cadastro-ambientes">{(cadastro?.ambientes ?? []).map((s) => <option key={s} value={s} />)}</datalist>
        </div>

        <div className="space-y-2">
          <span className={rotulo}>Foto do equipamento</span>
          {fotoEquip
            ? <Miniatura src={fotoEquip} alt="foto do equipamento" pendente onRemover={() => setFotoEquip(null)} />
            : <BotaoFoto grande rotulo="Fotografar o equipamento" marca={marcaFoto} onFoto={setFotoEquip} />}
        </div>

        <div className="space-y-2" data-qr-cadastro>
          <span className={rotulo}>QR Code</span>
          {qrLido ? (
            <p className="flex items-center justify-between gap-2 rounded-card border border-success-200 bg-success-50 px-3 py-2 text-sm text-success-800" data-qr-lido>
              <span className="inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Etiqueta QR lida.</span>
              <button type="button" onClick={() => setQrLido(null)} aria-label="Descartar a etiqueta QR lida" className="inline-flex items-center justify-center touch-target"><X className="w-5 h-5" /></button>
            </p>
          ) : (
            <>
              <button type="button" onClick={() => setScan(true)} data-ler-qr-cadastro
                className="w-full rounded-card border border-surface-border bg-white text-ink py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target"><ScanLine className="w-5 h-5" /> Ler a etiqueta QR do equipamento</button>
              <p className="flex items-start gap-2 text-xs text-ink-muted"><QrCode className="w-4 h-4 shrink-0" /> Sem etiqueta? O número do QR é gerado ao salvar.</p>
            </>
          )}
          {qrDeOutro && (
            <div role="status" className="rounded-card border border-atencao/20 bg-atencao-claro px-3 py-2 text-sm text-atencao-texto space-y-1.5" data-qr-de-outro>
              <p className="font-semibold">Este QR já é de {qrDeOutro.titulo}.</p>
              {!naOs.has(qrDeOutro.id) && (
                <button type="button" onClick={() => vincularExistente(qrDeOutro.id)} className="inline-flex items-center rounded-card border border-atencao/40 bg-white px-3 text-sm font-semibold text-ink touch-target">Vincular este à OS</button>
              )}
            </div>
          )}
        </div>

        {erro && <p role="alert" className="rounded-card bg-atrasado-claro px-3 py-2 text-sm text-atrasado-texto" data-erro-cadastro>{erro}</p>}
        <button type="button" disabled={salvando || lendo} onClick={salvar} data-salvar-equipamento
          className="w-full rounded-card bg-primary-600 text-white py-4 text-base font-bold disabled:opacity-40 touch-target">Cadastrar e vincular à OS</button>
      </div>
      {scan && <ScannerQR onFechar={() => setScan(false)} onLer={aoLerQr} />}
    </Modal>
  );
}
