import { NextResponse, type NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { meuDia } from "@/lib/tecnico/dia";
import { MSG_SEM_TECNICO, tecnicoDaSessao } from "@/lib/tecnico/sessao";
import { aplicarPrivacidade } from "@/lib/tecnico/cartao";
import { carregarConfigApp } from "@/lib/tecnico/config-app-server";
import { comMateriaisPrevistos } from "@/lib/tecnico/o-que-levar-server";
import { andamentoDaEmpresa } from "@/lib/execucao/andamento-server";
import { CABECALHO_ANTES, CABECALHO_APARELHO, CABECALHO_FILA, idsDoAntes, lerNoticia } from "@/lib/tecnico/saiu-do-dia";
import { noticiaDoOutro, registrarNoticia, saidasDoDia } from "@/lib/tecnico/saiu-do-dia-server";

/**
 * "Meu dia": as atividades de hoje atribuídas ao técnico do usuário (+ as começadas e não concluídas).
 * App pronto pra janeiro 2: o cabeçalho "antes" (os ids que o aparelho tinha hoje) → `saidas` (D9: as que o escritório tirou do
 * dia, e por quê); os cabeçalhos do aparelho (id e quantas gravações tem na fila) → `outroAparelho` (D11: o outro
 * aparelho deu notícia de gravação sem enviar).
 */
export async function GET(req?: NextRequest) {
  const guard = await exigirPermissao("ordens", "visualizar");
  if (guard.erro) return guard.resposta;
  const tecnico = await tecnicoDaSessao(guard.session);
  if (!tecnico) return NextResponse.json({ tecnico: null, aviso: MSG_SEM_TECNICO, dia: null, atividades: [], anteriores: [] });
  const empresaId = guard.session.user.empresaId;
  const [dia, config, andamento] = await Promise.all([meuDia(empresaId, tecnico.id), carregarConfigApp(empresaId), andamentoDaEmpresa(empresaId)]);
  // Permissões do app (Equipes › App do colaborador): dado do cliente oculto nem sai do servidor
  const ver = <T extends Parameters<typeof aplicarPrivacidade>[0]>(c: T) => aplicarPrivacidade(c, config);
  // "O que levar": os materiais previstos de cada OS (uma consulta para o dia todo); opção desligada = nada sai
  const [atividades, anteriores] = await Promise.all([
    comMateriaisPrevistos(empresaId, dia.atividades, config.oQueLevar), comMateriaisPrevistos(empresaId, dia.anteriores, config.oQueLevar),
  ]);
  const usuarioId = guard.session.user.id;
  const noticia = lerNoticia(req?.headers.get(CABECALHO_APARELHO), req?.headers.get(CABECALHO_FILA));
  const noMeuDia = new Set([...dia.atividades, ...dia.anteriores].map((c) => c.atividadeId));
  const [saidas, outroAparelho] = await Promise.all([
    saidasDoDia({ empresaId, tecnicoId: tecnico.id, usuarioId, ids: idsDoAntes(req?.headers.get(CABECALHO_ANTES)), noMeuDia }),
    noticia ? registrarNoticia(usuarioId, noticia).then(() => noticiaDoOutro(empresaId, usuarioId, noticia.aparelho)) : Promise.resolve(null),
  ]);
  return NextResponse.json({ tecnico, dia: dia.dia, atividades: atividades.map(ver), anteriores: anteriores.map(ver), andamento, saidas, outroAparelho }, { headers: { "Cache-Control": "private, no-store" } });
}
