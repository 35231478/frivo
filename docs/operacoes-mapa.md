# Operações › Mapa — última posição conhecida de cada técnico

Um mapa grande com um marcador por técnico, na **última posição conhecida**. Não é tempo real: é a
versão do app web (PWA), que só lê a localização com o app aberto. Foi desenhado para virar "ao vivo"
quando existir o app nativo, sem refazer a tela (ver "Pronto para o nativo").

## 🔵 Banco — dois itens, aditivos

**O SQL foi gerado e NÃO foi aplicado:** `prisma/sql/2026-12-08_mapa_posicao_tecnicos.sql`.

| Item | O que é |
|---|---|
| `configuracoes.app_rastrear_localizacao` (coluna nova, `BOOLEAN NOT NULL DEFAULT false`) | A permissão "Rastrear localização dos técnicos". **Todas as empresas começam DESLIGADAS.** |
| `tecnico_posicoes` (tabela nova) | A última posição de cada técnico. **Uma linha por técnico** (chave única em `tecnico_id`): a leitura mais nova substitui a anterior. Não há histórico de trajeto. |

- Aditivo e idempotente (pode rodar mais de uma vez); nada existente é removido nem alterado.
- **Rodar ANTES do merge** — o app lê a coluna e a tabela assim que o código entra:
  `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/2026-12-08_mapa_posicao_tecnicos.sql`
- O teste `sql-mapa-posicao` roda o arquivo num PostgreSQL de verdade e compara a tabela com a que o
  Prisma cria a partir do `schema.prisma`: colunas, tipos, padrões, índices e chaves idênticos.

**Por que uma tabela nova**, se o cadastro do técnico já tem `latitude`, `longitude` e
`ultima_localizacao`: essas colunas saem em toda leitura do cadastro (listas de colaboradores, por
exemplo). Posição em tempo quase real é dado sensível: fica numa tabela só dela, lida só pelo Mapa.
As colunas antigas não foram tocadas (hoje só são preenchidas à mão, por uma rota do escritório).

## Levantamento: o que já existia × o que foi criado

| Peça | Situação | Como entrou |
|---|---|---|
| Leaflet + OpenStreetMap (`leaflet`, `react-leaflet`, já usados no mapa do endereço do cliente) | **Reaproveitado** | A mesma biblioteca, sem chave de API e sem custo. |
| Leitura do GPS no app (`lib/tecnico/geo.ts`: usada na marca d'água com coordenadas) | **Reaproveitado** | A captura usa a mesma função. Ganhou a leitura da bateria. |
| "Exigir localização ativa" (App do colaborador) | Existia; **não é a mesma coisa** | É a trava do app (sem GPS, não abre). Não envia posição a ninguém. Segue independente: ligar uma não liga a outra. |
| Colunas de posição no cadastro do técnico + rotas `/api/tecnicos/[id]/localizacao` e `/proximos` | Existiam, sem tela | Preenchidas à mão pelo escritório. Não foram usadas nem alteradas (ver acima). |
| Módulo Frota | Existia | Não tem posição nem rastreamento: é cadastro e checklist de veículo. Nada a reaproveitar. |
| Fila offline do app e conta do relógio do aparelho (a do "Cheguei") | **Reaproveitado** | A posição usa o mesmo banco do aparelho e a mesma correção de horário. |
| Tela App do colaborador e o salvar das permissões | **Reaproveitado** | A chave nova entra numa seção "Localização". |
| Permissão existente Equipes › Gerenciar | **Reaproveitado** | É ela que libera o Mapa (não mexi no cadastro de perfis). |
| Página Mapa, item no menu Operações, marcadores, lista "Sem localização" | **Criado** | `app/(dashboard)/mapa`, `components/mapa/` |
| Captura no app (momentos-chave, fila, bateria) e o indicador de transparência | **Criado** | `lib/tecnico/offline/rastreio.ts`, `components/tecnico/indicador-localizacao.tsx` |
| Envio e leitura no servidor | **Criado** | `POST /api/tecnico/posicao`, `GET /api/mapa/posicoes`, `lib/tecnico/posicao*.ts` |
| Banco: a chave e a tabela | **Criado** | SQL acima |

## Consentimento (LGPD)

- **A chave:** Equipes › App do colaborador › Localização › "Rastrear localização dos técnicos".
  Por empresa, **desligada por padrão**. A tela avisa que é dado pessoal e pede consentimento.
- **Desligada, nada é capturado**, em três camadas:
  1. o app nem cria o rastreio: não pede a posição ao aparelho e não envia nada;
  2. o servidor recusa o que chegar (um app antigo aberto, por exemplo): não grava;
  3. o mapa não devolve posição nenhuma — nem as que já estavam guardadas.
- **Desligar com o app aberto:** no envio seguinte o servidor avisa, o app para de ler e apaga o que
  tinha guardado no aparelho.
- **Transparência:** com a chave ligada, o técnico vê uma faixa fixa no topo do app, "Localização
  compartilhada com a empresa". Tocando, ele lê o que é enviado, quando, e a hora da última leitura.
- **Cada um só envia a própria posição:** o servidor usa o técnico do usuário logado; o envio não
  aceita outro identificador.

**Decisões para conferir:**

1. **O consentimento é da empresa com os colaboradores.** O sistema dá a chave, o aviso e a faixa de
   transparência; não há um termo individual assinado pelo técnico dentro do app. Se você quiser um
   aceite por técnico, é uma etapa a mais (com banco).
2. **Desligar não apaga as posições guardadas.** Elas deixam de aparecer e de sair do servidor, mas
   ficam na tabela. Não apaguei por conta própria (exclusão de dados). Se preferir que desligar
   apague, me diga.
3. **O navegador ainda pede a permissão de localização** ao técnico. Se ele negar, nada é enviado, o
   app segue funcionando e a faixa passa a dizer "Localização bloqueada: nada é enviado". O técnico
   aparece em "Sem localização" no mapa.

## Quando o app lê a posição

Só com o app aberto, na frente:

| Momento | Regra |
|---|---|
| Ao abrir o app / o Meu dia, ou voltar para ele | No máximo uma leitura por minuto |
| "Cheguei" | Sempre |
| Iniciar a execução (primeira gravação na OS) | Sempre |
| Concluir a atividade | Sempre |
| Ao sincronizar (quando sobe alguma gravação) | No máximo uma por minuto |
| A cada 5 minutos | Enquanto o app estiver na frente |

Cada leitura leva: latitude, longitude, precisão, bateria (quando o aparelho informa), o horário do
aparelho e o que a disparou. O servidor guarda só a mais nova de cada técnico.

**Bateria:** funciona no Android (Chrome). No iPhone a web não dá acesso à bateria: o mapa mostra
"—". O número nunca é inventado.

## Offline

- Sem sinal, cada leitura entra numa fila curta no aparelho (até 20; o servidor só quer a última).
- Quando o sinal volta, sobem juntas, cada uma com o seu horário. Fechar e reabrir o app não perde a fila.
- O mapa mostra a última posição que **chegou**. Uma leitura antiga que chega depois não sobrescreve
  uma mais nova.
- Relógio errado no aparelho não engana: o atraso é medido no próprio aparelho (a mesma conta do "Cheguei").
- Sem permissão, sem GPS ou sem espaço, nada trava: o técnico segue trabalhando.

## Frescor: não parecer tempo real

| Idade da posição | No mapa | Na lista |
|---|---|---|
| Até 15 min ("atual") | Marcador cheio, na cor da marca | "visto às 14:02 · há 5 min" |
| Até 3 h ("recente") | Marcador branco com contorno | "visto às 12:40 · há 1 h 20 min" |
| Mais de 3 h ("antiga") | Marcador cinza e apagado | Linha apagada; "visto em 10/11 às 17:42 · há 1 dia" + etiqueta "Posição antiga" no marcador |

- O subtítulo da tela diz: "Última posição conhecida de cada técnico. Não é tempo real."
- Técnico sem posição nenhuma fica na lista **"Sem localização"**, fora do mapa.
- A tela busca as posições de novo a cada 1 minuto e ao voltar para a aba; há o botão "Atualizar".
- Os limites (15 min e 3 h) são escolha minha; ficam em `lib/tecnico/posicao.ts`.

## O que aparece ao clicar no marcador

Nome do técnico, a OS em que ele está, "visto às HH:MM · há X min", as coordenadas com a precisão, a
bateria (ou "—") e um link para abrir o ponto no Google Maps.

**A OS:** a atividade em andamento dele (como responsável ou na equipe). Sem nenhuma, a atividade em
que ele tocou "Cheguei" hoje ("No local"). Senão, "Sem OS em andamento".

## Quem acessa

- **Só a gestão:** quem tem **Equipes › Gerenciar** (Administrador e Supervisor, nos perfis padrão).
  Vale para o item do menu, a página e a rota de dados.
- **O técnico não vê:** fica confinado ao `/tecnico`; se tentar abrir `/mapa`, volta para o app, e a
  rota de dados responde 403.
- **Quem aparece:** colaboradores ativos da equipe de **campo**. Administrativo e inativo, não.
- Multiempresa: tudo por empresa.

**Decisão para conferir:** usei a permissão que já existia, para não mexer no cadastro de perfis. Se
você quiser uma permissão própria "Mapa", é uma mudança no RBAC.

## Pronto para o nativo

O que muda quando existir o app de loja: **só quem envia e com que frequência**.

| Parte | Hoje (app web) | Com o app nativo |
|---|---|---|
| Envio | `POST /api/tecnico/posicao`, `origem: "PWA"`, 1 a 20 leituras | **O mesmo endereço**, `origem: "NATIVO"`, motivo `SEGUNDO_PLANO`, até 200 leituras por envio |
| Formato da leitura | lat, lng, precisão, bateria, horário, motivo | **O mesmo** |
| Consentimento | A chave da empresa | **A mesma** |
| Armazenamento | `tecnico_posicoes`, a mais nova de cada técnico | **A mesma tabela** (origem e motivo já são colunas) |
| Tela do mapa | Busca a cada 1 minuto | **A mesma tela**; basta diminuir o intervalo (`INTERVALO_ATUALIZACAO_MS`) |

- Já há um teste que envia um lote de 60 leituras em segundo plano com origem NATIVO e confere que
  entra pelo mesmo caminho e aparece no mesmo mapa.
- **Fora desta entrega:** histórico de trajeto (a tabela guarda só a última posição). Se o "ao vivo"
  pedir o rastro, é uma tabela a mais, alimentada pelo mesmo envio — a tela não muda.

## Limites desta entrega

- **App web não rastreia em segundo plano.** Com o app fechado ou a tela bloqueada, não há leitura: a
  posição envelhece e o marcador vai ficando cinza. É o esperado, e é por isso que o frescor existe.
- **iPhone:** sem bateria (limite da web). Não testei em iPhone de verdade (sem WebKit neste ambiente).
- **Mapa depende de internet** no computador da gestão (as imagens vêm do OpenStreetMap).
- **Uso do OpenStreetMap:** os servidores públicos de imagens têm política de uso justo. Para uma
  empresa, o volume de uma tela de gestão cabe; com muitas empresas, vale contratar um provedor de
  imagens — troca-se uma linha (o endereço das imagens).

## Testes

- `sql-mapa-posicao` (8, PostgreSQL real): o SQL de produção, idêntico ao schema; aditivo; idempotente.
- `mapa-posicao-pg` (16, PostgreSQL real): consentimento (desligado não grava e não devolve), a última
  posição (uma linha; a antiga não sobrescreve; relógio errado), quem envia, quem vê (403 para técnico
  e para quem só visualiza equipes), multiempresa, a OS do técnico, lote do nativo.
- `mapa-posicao` (25): frescor e textos; a captura no aparelho com o banco de verdade (fila sem
  sinal, fechar e reabrir, intervalo, permissão negada, bateria ausente, empresa que desliga).
- `mapa-app-tecnico-ui` (11): no app — desligado nada é lido; ligado, a faixa de transparência; leitura
  em cada momento-chave; sem sinal; bloqueada.
- `mapa-ui` (16): a tela — marcadores × "Sem localização", frescor, o cartão do marcador, desligado, a
  chave no App do colaborador e o item do menu só para a gestão.
- `config-app`: duas expectativas atualizadas **de propósito** — a lista de permissões do app passou de
  13 para 14, com a nova nascendo desligada.
- Mutação: 32 regras quebradas de propósito (consentimento, quem envia e quem vê, a última posição, a
  captura, o frescor), todas pegas pelos testes (uma exigiu uma asserção a mais).

## Conferido no navegador (Chromium, app real, desktop e celular)

O mapa é o Leaflet de verdade, com as imagens do OpenStreetMap; o GPS do aparelho é simulado.

| Cenário | Resultado |
|---|---|
| Rastreamento desligado | Mapa sem marcadores, com o aviso; no app do técnico, sem faixa e nenhum envio de posição |
| Ligar pela tela (App do colaborador) | A chave salva no banco |
| Técnico abre o app | Faixa "Localização compartilhada com a empresa"; a posição chega ao banco (motivo: abriu o app) |
| "Cheguei" sem sinal | A leitura fica no aparelho (1 a enviar); o sinal volta e ela sobe (motivo: cheguei) |
| Mapa da gestão | 3 marcadores (atual, recente, antiga); imagens do mapa carregadas; zoom − / + e "Enquadrar todos" |
| Clicar no técnico | Nome, "Executando OS-2026-0102 · Hospital Santa Luzia", "visto às… · agora", coordenadas ±14 m, bateria |
| Aparelho sem bateria informada | "Bateria: —" |
| Posição de 26 h atrás | Marcador cinza, "visto em 10/11 às… · há 1 dia", etiqueta "Posição antiga" |
| Sem posição | Dois técnicos na lista "Sem localização" |
| Técnico tentando abrir o Mapa | Volta para o app; a rota de dados responde 403 |
| Localização negada no navegador | Faixa "Localização bloqueada: nada é enviado"; nada no banco |
| Empresa desliga com posições guardadas | Mapa vazio; a rota não devolve nenhuma |

A bateria que aparece nos prints (100%, carregando) é a que o navegador de teste informa. Não testei
em iPhone de verdade nem em Android de verdade.
