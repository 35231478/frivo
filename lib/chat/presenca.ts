/**
 * CHAT-1.2 — SITUAÇÃO e PRESENÇA do técnico, como o ESCRITÓRIO vê na lista Pessoas e no cabeçalho da conversa. Regras
 * PURAS (servidor, tela e testes usam as mesmas). Para técnico de campo, "online" sozinho diz pouco: o que importa é o
 * que ele está fazendo e se a mensagem vai chegar.
 *
 * SITUAÇÃO (uma linha, derivada do que o sistema já sabe), nesta prioridade:
 *  1. "Pausada — <motivo>": a atividade em andamento dele está com a pausa aberta (D1, atividade_pausas). Se ele tem
 *     OUTRA atividade em andamento SEM pausa, ele está executando aquela: vale "Em execução" (a pausa esquecida de
 *     ontem não esconde o serviço de hoje).
 *  2. "Em execução · OS-N": atividade em andamento (a iniciada por último).
 *  3. "A caminho · OS-N": avisou "A caminho" HOJE numa atividade ainda não iniciada, e não avisou "Cheguei" nela.
 *  4. "Fora do expediente": nada acima e a hora está fora da jornada dele (as faixas do cadastro). O intervalo do
 *     almoço conta como dentro. Sem jornada cadastrada, nunca é "fora".
 *  5. "Sem atividade agora".
 *
 * PRESENÇA (do contato do APP com o servidor — `usuarios.ultimo_contato_em`, gravado no máximo 1 vez por minuto):
 *  - ponto verde: o app falou com o servidor nos últimos 2 minutos;
 *  - "Sem sinal há N min": há mensagem do escritório esperando por ele e ele está sem contato há 10 min ou mais;
 *  - senão "visto por último às HH:MM" (hoje), "visto por último ontem" ou "visto por último em DD/MM".
 *
 * Só o ESCRITÓRIO vê (permissão "Conversas"); o técnico NÃO vê quem do escritório está online (decisão de produto: a
 * conversa dele é com "o Escritório"). Sem localização nesta linha (isso é do mapa).
 */
import { ehDia, faixasDoColaborador, minutosDaHora, DIAS_SEMANA, type FaixaJornada } from "@/lib/colaborador/jornada";
import { chaveDiaBR, horaBR, partesBR } from "@/lib/fuso";

/** O app esteve ativo há no máximo isso: ponto verde */
export const ONLINE_MS = 2 * 60_000;
/** A gravação do contato: no máximo 1 vez por este intervalo, por usuário */
export const INTERVALO_CONTATO_MS = 60_000;
/** Com mensagem do escritório esperando, sem contato há pelo menos isto: "Sem sinal há N min" */
export const SEM_SINAL_MIN = 10;
/** Sem contato há mais que isto não é mais "sem sinal": é "visto por último" */
const SEM_SINAL_MAX_MS = 24 * 3_600_000;

/** A OS da situação. `id` null = quem vê não pode abrir esta OS ("Ver só os próprios"): o número não aparece */
export interface OsSituacao { id: string | null; numero: string }

export type Situacao =
  | { tipo: "PAUSADA"; motivo: string; impedimento: boolean; os: OsSituacao | null }
  | { tipo: "EM_EXECUCAO"; os: OsSituacao | null }
  | { tipo: "A_CAMINHO"; os: OsSituacao | null }
  | { tipo: "FORA_DO_EXPEDIENTE" }
  | { tipo: "SEM_ATIVIDADE" };

/** O que o servidor manda por técnico (a lista, o cabeçalho e o tempo real) */
export interface EstadoTecnico {
  usuarioId: string;
  situacao: Situacao;
  /** O último contato do app com o servidor (ISO); null = nunca */
  contatoEm: string | null;
}

/** As atividades em andamento dele (com a pausa aberta, se houver) e os avisos de hoje — o que o servidor lê */
export interface EntradaSituacao {
  emAndamento: { os: OsSituacao | null; iniciadaEm: Date | string | null; pausa: { motivo: string; impedimento: boolean; inicio: Date | string } | null }[];
  /** Avisos "A caminho" de HOJE em atividade ainda não iniciada e sem "Cheguei" */
  aCaminho: { os: OsSituacao | null; em: Date | string }[];
  /** A jornada do cadastro do técnico (os campos crus: faixas ou o horário antigo) */
  jornada: Parameters<typeof faixasDoColaborador>[0];
}

const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : 0);
const maisRecente = <T>(lista: T[], quando: (x: T) => number): T | undefined => [...lista].sort((a, b) => quando(b) - quando(a))[0];

/** A hora de agora está dentro de alguma faixa da jornada? (sem jornada: null — não dá para dizer) */
export function dentroDaJornada(faixas: readonly FaixaJornada[], agora: Date): boolean | null {
  const validas = faixas.filter((f) => minutosDaHora(f.entrada) != null && minutosDaHora(f.saida) != null && f.dias.length);
  if (!validas.length) return null;
  const p = partesBR(agora);
  // getUTCDay: 0 = domingo; DIAS_SEMANA começa na segunda
  const dia = DIAS_SEMANA[(p.diaSemana + 6) % 7];
  const min = p.hora * 60 + p.minuto;
  return validas.some((f) => {
    if (!f.dias.filter(ehDia).includes(dia)) return false;
    const ini = minutosDaHora(f.entrada)!;
    const fim = minutosDaHora(f.saida)!;
    // Faixa que atravessa a meia-noite (22:00–06:00): a parte de hoje à noite (a da madrugada é da faixa do dia anterior)
    return fim > ini ? min >= ini && min < fim : min >= ini || min < fim;
  });
}

export function situacaoDoTecnico(e: EntradaSituacao, agora: Date): Situacao {
  const ativas = e.emAndamento.filter((a) => !a.pausa);
  if (ativas.length) return { tipo: "EM_EXECUCAO", os: maisRecente(ativas, (a) => ms(a.iniciadaEm))!.os };
  const pausada = maisRecente(e.emAndamento, (a) => ms(a.pausa?.inicio));
  if (pausada?.pausa) return { tipo: "PAUSADA", motivo: pausada.pausa.motivo, impedimento: pausada.pausa.impedimento, os: pausada.os };
  const caminho = maisRecente(e.aCaminho, (a) => ms(a.em));
  if (caminho) return { tipo: "A_CAMINHO", os: caminho.os };
  if (dentroDaJornada(faixasDoColaborador(e.jornada), agora) === false) return { tipo: "FORA_DO_EXPEDIENTE" };
  return { tipo: "SEM_ATIVIDADE" };
}

/** O texto da situação (sem a OS: a tela põe o número, clicável onde der) */
export function textoDaSituacao(s: Situacao): string {
  switch (s.tipo) {
    case "PAUSADA": return `Pausada — ${s.motivo}`;
    case "EM_EXECUCAO": return "Em execução";
    case "A_CAMINHO": return "A caminho";
    case "FORA_DO_EXPEDIENTE": return "Fora do expediente";
    case "SEM_ATIVIDADE": return "Sem atividade agora";
  }
}

/** A OS que aparece junto (só a que quem vê pode abrir) */
export const osDaSituacao = (s: Situacao): (OsSituacao & { id: string }) | null =>
  "os" in s && s.os?.id ? (s.os as OsSituacao & { id: string }) : null;

export type Presenca =
  | { tipo: "ONLINE"; texto: string }
  | { tipo: "SEM_SINAL"; texto: string }
  | { tipo: "VISTO"; texto: string };

/** "há 12 min" / "há 3 h" */
function ha(msDecorridos: number): string {
  const min = Math.floor(msDecorridos / 60_000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h`;
}

/**
 * A presença a partir do último contato do app. `aguardando` = há mensagem do escritório que ele ainda não leu (a
 * mensagem fica esperando por ele). Nunca entrou pelo app: null (nada a dizer).
 */
export function presencaDoTecnico(contatoEm: string | Date | null | undefined, agora: Date, aguardando: boolean): Presenca | null {
  if (!contatoEm) return null;
  const quando = new Date(contatoEm);
  const decorrido = Math.max(0, agora.getTime() - quando.getTime());
  if (decorrido <= ONLINE_MS) return { tipo: "ONLINE", texto: "No app agora" };
  if (aguardando && decorrido >= SEM_SINAL_MIN * 60_000 && decorrido < SEM_SINAL_MAX_MS) return { tipo: "SEM_SINAL", texto: `Sem sinal há ${ha(decorrido)}` };
  const hoje = chaveDiaBR(agora);
  const dia = chaveDiaBR(quando);
  if (dia === hoje) return { tipo: "VISTO", texto: `visto por último às ${horaBR(quando)}` };
  if (dia === chaveDiaBR(new Date(agora.getTime() - 86_400_000))) return { tipo: "VISTO", texto: "visto por último ontem" };
  return { tipo: "VISTO", texto: `visto por último em ${dia.slice(8, 10)}/${dia.slice(5, 7)}` };
}

/** A mensagem do escritório que ele ainda não leu, pela última da conversa: ela fica esperando por ele */
export const aguardandoTecnico = (ultima: { origem?: string; lida?: boolean } | null | undefined) =>
  !!ultima && ultima.origem === "ESCRITORIO" && ultima.lida === false;

/** A legenda (o ⓘ): o que a linha quer dizer, sem texto na tela */
export const LEGENDA_SITUACAO = [
  "A linha embaixo do nome diz o que o técnico está fazendo agora, nesta ordem: pausada (com o motivo), em execução, a caminho, fora do expediente (pela jornada do cadastro) ou sem atividade.",
  "Ponto verde: o app dele falou com o sistema nos últimos 2 minutos.",
  `"Sem sinal há N min": há mensagem do escritório esperando por ele e o app não fala com o sistema há ${SEM_SINAL_MIN} minutos ou mais; ela chega quando o sinal voltar.`,
  "Senão, quando o app falou com o sistema pela última vez.",
].join(" ");
