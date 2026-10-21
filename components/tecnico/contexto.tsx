"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync, type EstadoSync } from "@/lib/tecnico/offline/motor";
import { estadoDaAtividade } from "@/lib/tecnico/offline/estado";
import type { NovaOperacao, OperacaoFila, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

export interface UsuarioApp { id: string; nome: string; email: string; empresaNome: string; podeGravar: boolean }

interface Contexto {
  usuario: UsuarioApp;
  motor: MotorSync | null;
  estado: EstadoSync;
  /** O navegador não guarda dados offline (ex.: aba anônima antiga) */
  semBanco: boolean;
}

const ESTADO_INICIAL: EstadoSync = { situacao: "sincronizado", pendentes: 0, erros: 0, ultimoSync: null, versao: 0 };
const Ctx = createContext<Contexto | null>(null);

/** Abre o banco do aparelho (um por usuário) e liga o motor de sincronização. */
export function ProvedorTecnico({ usuario, children, motorPronto }: { usuario: UsuarioApp; children: React.ReactNode; motorPronto?: MotorSync }) {
  const [motor, setMotor] = useState<MotorSync | null>(motorPronto ?? null);
  const [estado, setEstado] = useState<EstadoSync>(ESTADO_INICIAL);
  const [semBanco, setSemBanco] = useState(false);

  useEffect(() => {
    if (motorPronto) return;
    let m: MotorSync | null = null;
    let cancelado = false;
    BancoTecnico.abrir(usuario.id)
      .then((banco) => {
        if (cancelado) { banco.fechar(); return; }
        m = new MotorSync(banco);
        m.ligar();
        setMotor(m);
      })
      .catch(() => setSemBanco(true));
    return () => { cancelado = true; m?.parar(); m?.banco.fechar(); };
  }, [usuario.id, motorPronto]);

  useEffect(() => motor?.assinar(setEstado), [motor]);

  const valor = useMemo(() => ({ usuario, motor, estado, semBanco }), [usuario, motor, estado, semBanco]);
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useTecnico() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTecnico fora do ProvedorTecnico");
  return c;
}

/* ───────── Vistas (uma página só: abre sem sinal; a vista vem da query) ───────── */

export type Vista =
  | { ver: "dia" }
  | { ver: "agenda" }
  | { ver: "perfil" }
  | { ver: "os"; a: string; e?: string | null };

export function lerVista(search: string): Vista {
  const q = new URLSearchParams(search);
  const ver = q.get("ver");
  const a = q.get("a");
  if (ver === "os" && a) return { ver: "os", a, e: q.get("e") };
  if (ver === "agenda" || ver === "perfil") return { ver };
  return { ver: "dia" };
}

export function urlDaVista(v: Vista): string {
  if (v.ver === "dia") return "/tecnico";
  if (v.ver === "os") return `/tecnico?ver=os&a=${encodeURIComponent(v.a)}${v.e ? `&e=${encodeURIComponent(v.e)}` : ""}`;
  return `/tecnico?ver=${v.ver}`;
}

const EVENTO = "frivo:vista";

/** Troca de vista sem recarregar (histórico do navegador funciona: o "voltar" do celular volta a vista). */
export function irPara(v: Vista, substituir = false) {
  const url = urlDaVista(v);
  if (substituir) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(EVENTO));
  window.scrollTo({ top: 0 });
}

export function useVista(): Vista | null {
  // null no servidor e no 1º render: a vista sai do endereço só no aparelho (a cópia guardada serve a qualquer ?…)
  const [v, setV] = useState<Vista | null>(null);
  useEffect(() => {
    const ler = () => setV(lerVista(window.location.search));
    ler();
    window.addEventListener("popstate", ler);
    window.addEventListener(EVENTO, ler);
    return () => { window.removeEventListener("popstate", ler); window.removeEventListener(EVENTO, ler); };
  }, []);
  return v;
}

/* ───────── Uma atividade: retrato guardado + fila, com o servidor ao fundo ───────── */

export function useAtividade(atividadeId: string) {
  const { motor, estado } = useTecnico();
  const [retrato, setRetrato] = useState<RetratoAtividade | null>(null);
  const [fila, setFila] = useState<OperacaoFila[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [baixando, setBaixando] = useState(false);

  // Relê do aparelho a cada mudança da fila/retratos
  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    Promise.all([motor.banco.retrato(atividadeId), motor.banco.filaDaAtividade(atividadeId)]).then(([g, f]) => {
      if (!vivo) return;
      setRetrato(g?.retrato ?? null);
      setFila(f);
      setCarregando(false);
    });
    return () => { vivo = false; };
  }, [motor, atividadeId, estado.versao]);

  // Ao abrir: retrato novo do servidor (se houver sinal)
  useEffect(() => {
    if (!motor) return;
    setBaixando(true);
    motor.baixarRetrato(atividadeId).finally(() => setBaixando(false));
  }, [motor, atividadeId]);

  const tela = useMemo(() => (retrato ? estadoDaAtividade(retrato, fila) : null), [retrato, fila]);

  /** Grava (na fila do aparelho). A 1ª gravação numa atividade agendada também a marca como iniciada. */
  const registrar = useCallback(async (ops: NovaOperacao[]) => {
    if (!motor) return;
    const iniciar = tela?.atividade.status === "AGENDADA" && !fila.some((o) => o.tipo === "iniciar") && !ops.some((o) => o.tipo === "iniciar");
    const todas: NovaOperacao[] = iniciar ? [{ tipo: "iniciar", atividadeId }, ...ops] : ops;
    const feitas = await motor.registrar(todas);
    setFila((f) => [...f, ...feitas]);
  }, [motor, tela?.atividade.status, fila, atividadeId]);

  const aEnviar = fila.filter((o) => o.estado !== "enviada").length;
  return { retrato, tela, fila, aEnviar, registrar, carregando: carregando || (!retrato && baixando), baixando };
}
