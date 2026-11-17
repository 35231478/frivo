"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronDown, FolderDown, Link2, Mail, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Stepper } from "@/components/ui/stepper";
import { Dica } from "@/components/ui/dica";
import { ClienteCombobox } from "@/components/ui/cliente-combobox";
import { toast } from "@/components/ui/avisos";
import { cn } from "@/lib/utils";
import {
  CATEGORIAS_PADRAO, CLIENTES_NO_LOTE_MAX, ORGANIZACAO_PADRAO, ORGANIZACOES, ROTULO_ORGANIZACAO, VALIDADE_PADRAO_DIAS,
  categoriasEnviaveisPorGrupo, type Organizacao, type Via,
} from "@/lib/documentacao/pacote";
import { baixarZipDoEnvio } from "@/lib/documentacao/baixar-cliente";
import type { ColaboradorSugerido, EnvioCriado, Previa, ResultadoDoLote } from "@/lib/documentacao/pacote-server";
import { CamposEmail, SeletorValidade } from "@/components/documentacao/campos-email";
import { PreviaPacote } from "@/components/documentacao/previa-pacote";
import { SeletorColaboradores, type ColaboradorDoPacote } from "@/components/documentacao/seletor-colaboradores";
import { ResultadoEnvio, type Resultado } from "@/components/documentacao/resultado-envio";

/** Um cliente do envio: quem vai no pacote dele, a prévia dele e os destinatários dele. */
interface Destino {
  clienteId: string;
  clienteNome: string;
  contratoId: string;
  contratos: { id: string; numero: string }[];
  pessoas: ColaboradorDoPacote[];
  marcados: string[];
  carregando: boolean;
  erro: string;
  email: { para: string[]; cc: string[] };
  previa: Previa | null;
  previaErro: string;
  ciente: boolean;
}

const PASSOS = [
  { id: "quem", rotulo: "Cliente e colaboradores" },
  { id: "o-que", rotulo: "Documentos e pastas" },
  { id: "previa", rotulo: "Prévia e envio" },
];

const SAIDAS: { via: Via; rotulo: string; ajuda: string; icone: React.ComponentType<{ className?: string }> }[] = [
  { via: "LINK", rotulo: "Gerar link", ajuda: "Um endereço com prazo, só de leitura, que dá para revogar.", icone: Link2 },
  { via: "ZIP", rotulo: "Baixar zip", ajuda: "O pacote em pastas, baixado neste computador.", icone: FolderDown },
  { via: "EMAIL", rotulo: "Enviar e-mail", ajuda: "O e-mail leva o link, não os anexos.", icone: Mail },
];

const AJUDA_LOTE = "Para a renovação anual: vários clientes de uma vez. Cada cliente recebe o link dele, com os documentos de quem atende a ele e os destinatários do cadastro dele. Nenhum cliente vê o link nem o e-mail de outro.";

const destinoNovo = (clienteId: string, clienteNome: string): Destino => ({
  clienteId, clienteNome, contratoId: "", contratos: [], pessoas: [], marcados: [], carregando: true, erro: "",
  email: { para: [], cc: [] }, previa: null, previaErro: "", ciente: false,
});

/** Dá para entregar este cliente? Vencido segura; falta pede a confirmação; e-mail pede destinatário. */
function prontoParaEnviar(d: Destino, via: Via): boolean {
  if (!d.previa || !d.previa.liberado) return false;
  if (d.previa.faltando.length > 0 && !d.ciente) return false;
  if (via === "EMAIL" && d.email.para.length === 0) return false;
  return true;
}

function porQueNaoVai(d: Destino, via: Via): string {
  if (d.previaErro) return d.previaErro;
  if (!d.previa) return "Carregando a prévia…";
  if (d.previa.vencidos.length) return "Segurado: há documento vencido";
  if (!d.previa.itens.length) return "Nenhum documento encontrado";
  if (d.previa.faltando.length && !d.ciente) return "Falta confirmar os documentos ausentes";
  if (via === "EMAIL" && !d.email.para.length) return "Sem e-mail de destino";
  return "";
}

/**
 * NOVO ENVIO da documentação da equipe, em três passos:
 *  1. o cliente (e o contrato, se quiser estreitar) e quem atende — já sugerido e marcado;
 *  2. os tipos de documento (segurança do trabalho marcada; contrato e documento pessoal não) e as pastas;
 *  3. a prévia — que segura o envio se houver vencido — e a saída: link, zip ou e-mail.
 *
 * O envio para VÁRIOS CLIENTES (lote) é o mesmo assistente com mais de um destino: cada cliente
 * tem a sua lista, a sua prévia e os seus destinatários, e recebe o seu próprio link.
 *
 * A tela nunca decide sozinha: quem diz o que entra, o que segura e quem recebe é o servidor (a
 * prévia e o envio). Quando ele recusa, a razão aparece aqui e a tela NÃO anda para o resultado.
 */
export function NovoEnvio({ equipes, colaboradores }: {
  equipes: { id: string; nome: string }[];
  colaboradores: { id: string; nome: string }[];
}) {
  const [passo, setPasso] = useState(0);
  const [lote, setLote] = useState(false);
  const [destinos, setDestinos] = useState<Destino[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [chaveCombo, setChaveCombo] = useState(0);
  const [categorias, setCategorias] = useState<string[]>(CATEGORIAS_PADRAO);
  const [organizacao, setOrganizacao] = useState<Organizacao>(ORGANIZACAO_PADRAO);
  const [via, setVia] = useState<Via>("LINK");
  const [dias, setDias] = useState<number>(VALIDADE_PADRAO_DIAS);
  const [copiaParaMim, setCopiaParaMim] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const mudar = useCallback((clienteId: string, f: (d: Destino) => Destino) => {
    setDestinos((ds) => ds.map((d) => (d.clienteId === clienteId ? f(d) : d)));
  }, []);

  /* ───── passo 1: cliente e colaboradores ───── */

  /** Busca quem atende o cliente (e os contratos e e-mails dele). Trocar o contrato refaz a sugestão. */
  const sugerir = useCallback(async (clienteId: string, contratoId: string) => {
    mudar(clienteId, (d) => ({ ...d, carregando: true, erro: "" }));
    try {
      const q = new URLSearchParams({ clienteId, ...(contratoId ? { contratoId } : {}) });
      const res = await fetch(`/api/documentacao/sugestoes?${q}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { mudar(clienteId, (d) => ({ ...d, carregando: false, erro: data?.erro ?? "Não foi possível buscar os colaboradores." })); return; }
      const sugeridos = (data.colaboradores ?? []) as ColaboradorSugerido[];
      mudar(clienteId, (d) => {
        // quem a pessoa já acrescentou à mão (ou por equipe) continua na lista ao trocar o contrato
        const manuais = d.pessoas.filter((p) => (p.motivo === "MANUAL" || p.motivo === "EQUIPE") && !sugeridos.some((s) => s.id === p.id));
        const pessoas = [...sugeridos.map((s) => ({ id: s.id, nome: s.nome, motivo: s.motivo })), ...manuais];
        return {
          ...d, carregando: false, pessoas,
          marcados: [...sugeridos.map((s) => s.id), ...manuais.filter((m) => d.marcados.includes(m.id)).map((m) => m.id)],
          contratos: data.contratos ?? [], email: data.email ?? { para: [], cc: [] }, previa: null,
        };
      });
    } catch {
      mudar(clienteId, (d) => ({ ...d, carregando: false, erro: "Erro de conexão. Tente de novo." }));
    }
  }, [mudar]);

  function escolherCliente(clienteId: string, nome: string) {
    if (!clienteId) { if (!lote) setDestinos([]); return; }
    if (destinos.some((d) => d.clienteId === clienteId)) { toast("Este cliente já está no envio.", "erro"); return; }
    if (lote && destinos.length >= CLIENTES_NO_LOTE_MAX) { toast(`No máximo ${CLIENTES_NO_LOTE_MAX} clientes por lote.`, "erro"); return; }
    setDestinos((ds) => (lote ? [...ds, destinoNovo(clienteId, nome)] : [destinoNovo(clienteId, nome)]));
    if (lote) { setChaveCombo((k) => k + 1); setAberto(null); }
    void sugerir(clienteId, "");
  }

  async function puxarEquipe(clienteId: string, equipeId: string) {
    const res = await fetch(`/api/documentacao/sugestoes?equipeId=${encodeURIComponent(equipeId)}`).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) { toast(data?.erro ?? "Não foi possível puxar a equipe.", "erro"); return; }
    const membros = (data.colaboradores ?? []) as ColaboradorSugerido[];
    if (!membros.length) { toast("Esta equipe não tem colaboradores ativos.", "erro"); return; }
    mudar(clienteId, (d) => {
      const novos = membros.filter((m) => !d.pessoas.some((p) => p.id === m.id));
      return {
        ...d, previa: null,
        pessoas: [...d.pessoas, ...novos.map((m) => ({ id: m.id, nome: m.nome, motivo: "EQUIPE" as const }))],
        marcados: [...new Set([...d.marcados, ...membros.map((m) => m.id)])],
      };
    });
  }

  const acrescentar = (clienteId: string, p: { id: string; nome: string }) =>
    mudar(clienteId, (d) => (d.pessoas.some((x) => x.id === p.id) ? d : {
      ...d, previa: null, pessoas: [...d.pessoas, { ...p, motivo: "MANUAL" }], marcados: [...d.marcados, p.id],
    }));

  function ligarLote(ligado: boolean) {
    setLote(ligado);
    setAberto(null);
    if (ligado) { if (via === "ZIP") setVia("LINK"); } else setDestinos((ds) => ds.slice(0, 1));
  }

  const semGente = destinos.filter((d) => !d.carregando && d.marcados.length === 0);
  const podeAvancarQuem = destinos.length > 0 && destinos.every((d) => !d.carregando && !d.erro) && semGente.length === 0;

  /* ───── passo 3: a prévia ───── */

  const selecaoDe = useCallback((d: Destino) => ({
    clienteId: d.clienteId, contratoId: d.contratoId || null, colaboradorIds: d.marcados, categorias, organizacao,
  }), [categorias, organizacao]);

  const carregarPrevia = useCallback(async (d: Destino) => {
    mudar(d.clienteId, (x) => ({ ...x, previa: null, previaErro: "" }));
    try {
      const res = await fetch("/api/documentacao/previa", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selecaoDe(d)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { mudar(d.clienteId, (x) => ({ ...x, previaErro: data?.erro ?? "Não foi possível montar a prévia." })); return; }
      mudar(d.clienteId, (x) => ({ ...x, previa: data as Previa, ciente: false }));
    } catch {
      mudar(d.clienteId, (x) => ({ ...x, previaErro: "Erro de conexão. Tente de novo." }));
    }
  }, [mudar, selecaoDe]);

  function irParaPrevia() {
    setErro(""); setPasso(2);
    for (const d of destinos) void carregarPrevia(d);
  }

  /** Tira a pessoa do pacote e refaz a prévia — uma das duas saídas do documento vencido. */
  function tirarDoPacote(d: Destino, colaboradorId: string) {
    const depois = { ...d, marcados: d.marcados.filter((m) => m !== colaboradorId) };
    mudar(d.clienteId, () => depois);
    void carregarPrevia(depois);
  }

  /* ───── a saída ───── */

  const prontos = destinos.filter((d) => prontoParaEnviar(d, via));

  async function enviar() {
    if (!prontos.length || enviando) return;
    setEnviando(true); setErro("");
    try {
      if (!lote) {
        const d = prontos[0];
        const res = await fetch("/api/documentacao/envios", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...selecaoDe(d), via, validadeDias: dias, cienteDasFaltas: d.ciente,
            email: via === "EMAIL" ? { para: d.email.para, cc: d.email.cc, copiaParaMim } : undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // A recusa do servidor vence: a razão dele aparece, a prévia é refeita e a tela não anda.
          const msg = data?.erro ?? "Não foi possível gerar o pacote."; setErro(msg); toast(msg, "erro");
          if (res.status === 409) void carregarPrevia(d);
          return;
        }
        const criado = data as EnvioCriado;
        let zip: { ok: boolean; erro?: string } | undefined;
        if (via === "ZIP") { const r = await baixarZipDoEnvio(criado.envio.id); zip = r.ok ? { ok: true } : { ok: false, erro: r.erro }; }
        setResultado({ tipo: "UM", via, criado, zip });
        return;
      }
      const res = await fetch("/api/documentacao/envios/lote", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          via, validadeDias: dias, copiaParaMim,
          envios: prontos.map((d) => ({ ...selecaoDe(d), cienteDasFaltas: d.ciente, email: via === "EMAIL" ? { para: d.email.para, cc: d.email.cc } : undefined })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { const msg = data?.erro ?? "Não foi possível enviar o lote."; setErro(msg); toast(msg, "erro"); return; }
      setResultado({
        tipo: "LOTE", via, lote: data as ResultadoDoLote,
        nomes: Object.fromEntries(destinos.map((d) => [d.clienteId, d.clienteNome])),
        deFora: destinos.filter((d) => !prontos.includes(d)).map((d) => ({ clienteNome: d.clienteNome, motivo: porQueNaoVai(d, via) })),
      });
    } catch {
      setErro("Erro de conexão. Tente de novo."); toast("Erro de conexão. Tente de novo.", "erro");
    } finally { setEnviando(false); }
  }

  if (resultado) return <ResultadoEnvio resultado={resultado} />;

  const unico = !lote ? destinos[0] : undefined;
  const quantos = `${prontos.length} de ${destinos.length} ${destinos.length === 1 ? "cliente" : "clientes"}`;
  const rotuloEnviar = lote
    ? `${via === "EMAIL" ? "Enviar e-mail" : "Gerar link"} para ${quantos}`
    : via === "LINK" ? "Gerar o link" : via === "ZIP" ? "Baixar o zip" : "Enviar o e-mail";

  /** O bloco de um cliente no passo 1: contrato e colaboradores. */
  const blocoQuem = (d: Destino) => (
    <div className="space-y-3" data-destino-quem={d.clienteId}>
      {d.erro && <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2" data-erro-sugestao>{d.erro}</p>}
      {d.contratos.length > 0 && (
        <FormField label="Contrato" dica="Deixe em todos para sugerir quem atende o cliente em qualquer contrato ativo. Escolher um contrato estreita a sugestão.">
          <Select
            value={d.contratoId} disabled={d.carregando} data-contrato
            onChange={(e) => { const contratoId = e.target.value; mudar(d.clienteId, (x) => ({ ...x, contratoId })); void sugerir(d.clienteId, contratoId); }}
          >
            <option value="">Todos os contratos ativos</option>
            {d.contratos.map((c) => <option key={c.id} value={c.id}>Contrato {c.numero}</option>)}
          </Select>
        </FormField>
      )}
      <FormField label="Colaboradores no pacote" dica="A lista vem sugerida: técnico de contrato ativo e quem executou ordem de serviço do cliente nos últimos 12 meses. O pacote leva quem estiver marcado.">
        <SeletorColaboradores
          pessoas={d.pessoas} marcados={d.marcados} carregando={d.carregando} equipes={equipes} todos={colaboradores}
          onMarcados={(marcados) => mudar(d.clienteId, (x) => ({ ...x, marcados, previa: null }))}
          onPuxarEquipe={(equipeId) => void puxarEquipe(d.clienteId, equipeId)}
          onAcrescentar={(p) => acrescentar(d.clienteId, p)}
        />
      </FormField>
    </div>
  );

  return (
    <div className="space-y-4" data-novo-envio data-passo={PASSOS[passo].id} data-lote={lote ? "sim" : "nao"}>
      <Stepper passos={PASSOS} atual={passo} rotulo="Passos do envio" data-passos-envio="" />

      <div className="bg-white rounded-card shadow-card border border-surface-border p-4 sm:p-6 space-y-5">
        {passo === 0 && (
          <>
            {!lote ? (
              <>
                <FormField label="Cliente" required>
                  <div data-cliente>
                    <ClienteCombobox value={unico?.clienteId ?? ""} initialLabel={unico?.clienteNome} onChange={(id, c) => escolherCliente(id, c ? c.nomeFantasia ?? c.nome : "")} />
                  </div>
                </FormField>
                {unico && blocoQuem(unico)}
              </>
            ) : (
              <>
                <FormField label="Clientes do lote" required hint={`Até ${CLIENTES_NO_LOTE_MAX} por vez. Cada cliente recebe o próprio link.`}>
                  <div data-cliente-lote>
                    <ClienteCombobox key={chaveCombo} value="" onChange={(id, c) => escolherCliente(id, c ? c.nomeFantasia ?? c.nome : "")} />
                  </div>
                </FormField>
                {destinos.length > 0 && (
                  <ul className="border border-surface-border rounded-lg divide-y divide-surface-linha" data-destinos-lote>
                    {destinos.map((d) => (
                      <li key={d.clienteId} data-destino={d.clienteId}>
                        <div className="flex items-center gap-2 px-3 py-2.5">
                          <button type="button" onClick={() => setAberto(aberto === d.clienteId ? null : d.clienteId)} className="flex-1 min-w-0 flex items-center gap-2 text-left" aria-expanded={aberto === d.clienteId} data-abrir-destino>
                            <ChevronDown className={cn("w-4 h-4 text-ink-muted shrink-0 transition-transform", aberto === d.clienteId && "rotate-180")} aria-hidden />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-ink truncate">{d.clienteNome}</span>
                              <span className={cn("block text-xs", !d.carregando && d.marcados.length === 0 ? "text-atrasado-texto" : "text-ink-muted")} data-destino-resumo>
                                {d.carregando ? "Procurando quem atende…" : d.erro ? d.erro : d.marcados.length === 0 ? "Nenhum colaborador marcado" : `${d.marcados.length} ${d.marcados.length === 1 ? "colaborador" : "colaboradores"}`}
                              </span>
                            </span>
                          </button>
                          <button type="button" onClick={() => setDestinos((ds) => ds.filter((x) => x.clienteId !== d.clienteId))} className="p-2 text-ink-muted hover:text-atrasado rounded-md" aria-label={`Tirar ${d.clienteNome} do lote`} data-tirar-destino>
                            <Trash2 className="w-4 h-4" aria-hidden />
                          </button>
                        </div>
                        {aberto === d.clienteId && <div className="px-3 pb-3">{blocoQuem(d)}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            <details className="group border-t border-surface-linha pt-3" open={lote} data-avancado>
              <summary className="text-sm font-medium text-ink-muted cursor-pointer select-none flex items-center gap-1.5 list-none">
                <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" aria-hidden /> Avançado
              </summary>
              <label className="mt-3 flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input
                  type="checkbox" checked={lote} onChange={(e) => ligarLote(e.target.checked)} data-ligar-lote
                  className="w-4 h-4 rounded border-surface-border text-acento focus:ring-acento"
                />
                <Users className="w-4 h-4 text-ink-muted" aria-hidden /> Enviar para vários clientes (lote)
                <Dica rotulo="Envio em lote" texto={AJUDA_LOTE} />
              </label>
            </details>
          </>
        )}

        {passo === 1 && (
          <>
            <fieldset className="space-y-3" data-tipos>
              <legend className="text-sm font-semibold text-ink flex items-center gap-1.5">
                Tipos de documento
                <Dica rotulo="Tipos de documento" texto="Segurança e medicina do trabalho já vem marcada: é o que o cliente costuma exigir. Contrato e documento pessoal ficam desmarcados e só vão se alguém marcar. Advertência e dado bancário nunca saem por aqui." />
              </legend>
              {categoriasEnviaveisPorGrupo().map((g) => (
                <div key={g.grupo} data-grupo-tipos={g.grupo}>
                  <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">{g.rotulo}</p>
                  <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
                    {g.itens.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                        <input
                          type="checkbox" checked={categorias.includes(c.id)} data-tipo={c.id}
                          onChange={(e) => setCategorias((cs) => (e.target.checked ? [...cs, c.id] : cs.filter((x) => x !== c.id)))}
                          className="w-4 h-4 rounded border-surface-border text-acento focus:ring-acento"
                        />
                        {c.rotulo}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>
            <FormField label="Organização das pastas" dica="É a estrutura do zip e da página que o cliente abre.">
              <Select value={organizacao} onChange={(e) => setOrganizacao(e.target.value as Organizacao)} data-organizacao>
                {ORGANIZACOES.map((o) => <option key={o} value={o}>{ROTULO_ORGANIZACAO[o]}</option>)}
              </Select>
            </FormField>
          </>
        )}

        {passo === 2 && (
          <>
            {unico ? (
              <div data-previa-de={unico.clienteId}>
                <h2 className="text-sm font-semibold text-ink mb-2">Prévia do pacote de {unico.clienteNome}</h2>
                {unico.previaErro ? (
                  <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2" data-erro-previa>{unico.previaErro}</p>
                ) : !unico.previa ? (
                  <p className="text-sm text-ink-muted" data-previa-carregando>Montando a prévia…</p>
                ) : (
                  <PreviaPacote
                    previa={unico.previa} ciente={unico.ciente} desabilitado={enviando}
                    onCiente={(ciente) => mudar(unico.clienteId, (x) => ({ ...x, ciente }))}
                    onTirar={(id) => tirarDoPacote(unico, id)}
                  />
                )}
              </div>
            ) : (
              <ul className="border border-surface-border rounded-lg divide-y divide-surface-linha" data-previas-lote>
                {destinos.map((d) => {
                  const motivo = porQueNaoVai(d, via);
                  return (
                    <li key={d.clienteId} data-previa-de={d.clienteId} data-pronto={motivo ? "nao" : "sim"}>
                      <button type="button" onClick={() => setAberto(aberto === d.clienteId ? null : d.clienteId)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left" aria-expanded={aberto === d.clienteId} data-abrir-previa>
                        <ChevronDown className={cn("w-4 h-4 text-ink-muted shrink-0 transition-transform", aberto === d.clienteId && "rotate-180")} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-ink truncate">{d.clienteNome}</span>
                          <span className={cn("block text-xs", motivo ? (d.previa ? "text-atrasado-texto font-medium" : "text-ink-muted") : "text-ink-muted")} data-previa-situacao>
                            {motivo || `${d.previa!.itens.length} ${d.previa!.itens.length === 1 ? "arquivo" : "arquivos"}${via === "EMAIL" ? ` · para ${d.email.para.join(", ")}` : ""}`}
                          </span>
                        </span>
                      </button>
                      {aberto === d.clienteId && (
                        <div className="px-3 pb-3 space-y-3">
                          {d.previa && (
                            <PreviaPacote
                              previa={d.previa} ciente={d.ciente} desabilitado={enviando}
                              onCiente={(ciente) => mudar(d.clienteId, (x) => ({ ...x, ciente }))}
                              onTirar={(id) => tirarDoPacote(d, id)}
                            />
                          )}
                          {via === "EMAIL" && (
                            <CamposEmail
                              valor={{ ...d.email, copiaParaMim }} desabilitado={enviando} semCopiaParaMim
                              onValor={(v) => mudar(d.clienteId, (x) => ({ ...x, email: { para: v.para, cc: v.cc } }))}
                            />
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <fieldset className="space-y-3 border-t border-surface-linha pt-4" data-saidas>
              <legend className="text-sm font-semibold text-ink">Como entregar</legend>
              <div className={cn("grid gap-2", lote ? "sm:grid-cols-2" : "sm:grid-cols-3")}>
                {SAIDAS.filter((s) => !lote || s.via !== "ZIP").map((s) => (
                  <label key={s.via} className={cn("flex items-start gap-2.5 border rounded-lg px-3 py-2.5 cursor-pointer", via === s.via ? "border-acento bg-acento/5" : "border-surface-border hover:border-primary-400")}>
                    <input type="radio" name="via" value={s.via} checked={via === s.via} onChange={() => setVia(s.via)} disabled={enviando} data-via={s.via} className="mt-0.5 w-4 h-4 text-acento focus:ring-acento" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-ink"><s.icone className="w-4 h-4 text-ink-muted" aria-hidden /> {s.rotulo}</span>
                      <span className="block text-xs text-ink-muted">{s.ajuda}</span>
                    </span>
                  </label>
                ))}
              </div>
              {via !== "ZIP" && <div className="sm:max-w-xs"><SeletorValidade valor={dias} onValor={setDias} desabilitado={enviando} /></div>}
              {via === "EMAIL" && unico && (
                <CamposEmail
                  valor={{ ...unico.email, copiaParaMim }} desabilitado={enviando}
                  onValor={(v) => { setCopiaParaMim(v.copiaParaMim); mudar(unico.clienteId, (x) => ({ ...x, email: { para: v.para, cc: v.cc } })); }}
                />
              )}
              {via === "EMAIL" && lote && (
                <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                  <input type="checkbox" checked={copiaParaMim} disabled={enviando} onChange={(e) => setCopiaParaMim(e.target.checked)} data-email-copia-para-mim className="w-4 h-4 rounded border-surface-border text-acento focus:ring-acento" />
                  Enviar uma cópia de cada e-mail para mim
                </label>
              )}
            </fieldset>

            {erro && <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2" data-erro-envio>{erro}</p>}
          </>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-surface-linha pt-4">
          {passo === 0 ? (
            <Link href="/documentacao-equipe" className="text-sm font-medium text-ink-muted hover:text-ink text-center sm:text-left" data-cancelar>Cancelar</Link>
          ) : (
            <Button type="button" variant="secondary" disabled={enviando} onClick={() => { setErro(""); setPasso(passo - 1); }} data-voltar>
              <ArrowLeft className="w-4 h-4" /> Voltar
            </Button>
          )}
          {passo === 0 && (
            <Button type="button" disabled={!podeAvancarQuem} onClick={() => setPasso(1)} data-avancar>
              Continuar <ArrowRight className="w-4 h-4" />
            </Button>
          )}
          {passo === 1 && (
            <Button type="button" disabled={categorias.length === 0} onClick={irParaPrevia} data-avancar data-ver-previa>
              Ver a prévia <ArrowRight className="w-4 h-4" />
            </Button>
          )}
          {passo === 2 && (
            <Button type="button" loading={enviando} disabled={prontos.length === 0} onClick={enviar} data-enviar>
              {rotuloEnviar}
            </Button>
          )}
        </div>
        {passo === 0 && semGente.length > 0 && (
          <p className="text-xs text-atrasado-texto" data-aviso-sem-gente>
            {lote ? `Marque pelo menos um colaborador em: ${semGente.map((d) => d.clienteNome).join(", ")}.` : "Marque pelo menos um colaborador para continuar."}
          </p>
        )}
        {passo === 2 && !lote && unico && porQueNaoVai(unico, via) && unico.previa && (
          <p className="text-xs text-ink-muted sm:text-right" data-motivo-bloqueio>{porQueNaoVai(unico, via)}.</p>
        )}
      </div>
    </div>
  );
}
