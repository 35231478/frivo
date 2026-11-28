# Erro no campo — um padrão único de validação em todos os formulários

O problema (pedido do Zé, com print): em **Clientes › Novo**, o CNPJ incompleto (`11.222.333/0001`) mostrava só a faixa
vermelha do topo — "Informe os 14 dígitos do CNPJ." — e o campo errado ficava igual aos outros: a pessoa precisava procurar.

Agora vale o padrão de mercado, feito **uma vez** nos componentes compartilhados e usado por todos os formulários
(escritório, portal e app do técnico). 🟢 Sem banco: nenhum SQL.

Prints fictícios (empresa demo "Polar Demo") em `docs/prints/erro-no-campo/`: antes e depois, em 1366, 1920 e celular (360 px).

## O que muda para quem usa

1. **O erro mora no campo.** O campo errado ganha a borda vermelha e a mensagem curta logo **abaixo** dele (o mesmo texto da
   faixa), com `aria-invalid` e `aria-describedby`. O rótulo **não** muda de cor.
2. **A faixa do topo vira resumo.**
   - Um erro só de campo: a faixa repete o texto.
   - Mais de um: "**N campos para corrigir**", com o nome de cada campo; tocar no nome leva ao campo.
   - Erro que não é de campo (conexão, permissão): fica só na faixa, e o foco vai para ela.
   - O "Dados inválidos" genérico do servidor não aparece quando os campos já dizem o que é.
3. **Ao salvar, a tela rola e dá foco no primeiro campo com erro.** Se ele está em **outra aba**, a aba ganha o ponto vermelho
   com a contagem, abre sozinha e o campo recebe o foco. O mesmo para seção recolhida ("Mais opções" do contrato) e `<details>`.
4. **O erro some assim que a pessoa corrige** — não só no próximo salvar. Obrigatório e erro do servidor somem ao digitar;
   erro de formato some quando o formato fica certo.
5. **Formato óbvio confere ao sair do campo** (CNPJ/CPF, e-mail, CEP, telefone/celular, data, hora, valor). Nunca acusa
   enquanto a pessoa digita pela primeira vez; vazio não é erro de formato (o obrigatório só acusa ao salvar).
6. **O erro do servidor cai no campo certo** (CNPJ já cadastrado, e-mail em uso, RT sem CREA, número de contrato repetido…).
7. Select, data, hora, data e hora, máscaras, seletor com busca, cadastro rápido, e-mails, células da tabela de itens e campos
   dentro de gavetas seguem o mesmo padrão.
8. Cores da identidade: o vermelho de erro que já existia (`atrasado` `#B42318` — contraste 6,6:1 no branco e 5,6:1 na faixa,
   AA). Funciona em 360 px (os nomes da lista da faixa quebram linha e têm 44 px de toque no celular).

## Como usar (para quem mexe no código)

```tsx
const erros = useErrosDoFormulario({ rhf: formState.errors, abaDoCampo: { cep: "enderecos" }, abrirAba: setAba });

<ErrosDoFormulario valor={erros}>
  <form ref={erros.ref} noValidate>
    <ResumoDeErros />
    <div data-aba-painel="dados" className={aba === "dados" ? "" : "hidden"}>
      <FormField label="CNPJ" name="cpfCnpj" formato="cnpj" required><Input … /></FormField>
      <FormField label="Cliente" name="clienteId" valor={clienteId}><SelectCadastroRapido … /></FormField>
```

- **Antes de salvar:** `if (!erros.validar({ nome: "Informe o nome." })) return;`. Marca, rola e foca.
- **Resposta da API:** `if (!res.ok) { erros.erroDaApi(await res.json(), "Erro ao salvar."); return; }`.
- **Aba com erro:** `<IndicadorErroAba n={erros.porAba.dados} />`. `Tabs` e `Drawer` aceitam `erros` em cada aba.
- **Peças:**
  - Regras puras: `lib/forms/erros.ts`.
  - Resposta do servidor: `lib/forms/erros-server.ts`.
  - Campo: `components/ui/form-field.tsx` + `campo-contexto.ts`.
  - Formulário: `components/ui/formulario-erros.tsx`.

### A resposta de erro da API

`{ erro, campos? }`. O `erro` de sempre continua lá, então quem lê só o `erro` não quebra.

| Helper | Responde |
|---|---|
| `erroNoCampo("cpfCnpj", "CPF/CNPJ já cadastrado", 409)` | `{ erro, campos: { cpfCnpj } }` |
| `errosNosCampos({ a, b }, "frase geral?")` | `{ erro, campos }` |
| `erroDeValidacao(parsed.error)` | o mesmo `{ erro: "Dados inválidos", detalhes: flatten() }` de antes **+** `campos` com o caminho de cada erro (`itens.2.quantidade`) |

A tela também entende o `detalhes` do zod das rotas que ainda não foram trocadas: a recusa delas já cai no campo.

## Levantamento — formulário × usa o padrão?

Legenda:
- ✅ **migrado nesta leva**: erro no campo, resumo, foco/aba e erro do servidor no campo.
- ◐ **parcial, pelos componentes**: onde a tela já passava `error=` ao `FormField`, o campo ganha borda, mensagem abaixo e
  aria; todo CEP (`CampoCep`) confere o formato ao sair. A tela continua com a faixa própria e ainda não foca o campo.
- ⬜ **2º PR**.

### Escritório

| Área | Formulário | Padrão |
|---|---|---|
| Clientes | Novo/Editar cliente (abas Dados, Endereços…) | ✅ |
| Clientes | Locais (unidades), contatos, anexos, portal do contato, comunicação | ◐ / ⬜ |
| Colaborador | Ficha do colaborador (abas) | ✅ |
| Colaborador | Acesso ao app | ✅ |
| Colaborador | Documentos, gerar/cancelar documento, nova admissão, folha | ◐ |
| Colaborador | Equipe, montador de equipes, App do colaborador, Desempenho, comissões | ⬜ |
| Orçamento | Novo/Editar orçamento (incl. células da tabela de itens) | ✅ |
| Orçamento | Gerar OS, aprovação interna, converter em contrato, envio/anexos/opções | ⬜ |
| Orçamento | Editar linha no contexto (`EdicaoNoContextoModal`) | ⬜ |
| OS | Nova OS (e aceitar solicitação) | ✅ |
| OS | Gaveta Editar a OS; gaveta Justificar atraso | ✅ |
| OS | Atividades, visitas, orçamento da OS, adicionais, fotos/anexos, prazos, separação, aceite, materiais | ⬜ |
| OS | Agendar no calendário | ⬜ |
| Contrato | Novo/Editar contrato (abas + "Mais opções") | ✅ |
| Contrato | Documentos, reajuste, relatório | ◐ / ⬜ |
| Medição / PMOC | Medição, retenções, PMOC (editor, cronograma, ocorrências, renovar, envio) | ◐ / ⬜ |
| Produto/Serviço e cadastros | Gaveta do cadastro padrão (produtos, serviços, fornecedores, cargos, categorias, centros de custo, contas…) | ✅ |
| Produto/Serviço e cadastros | Usuário (e-mail de login único) | ✅ |
| Produto/Serviço e cadastros | Tabela de preço, kit, modelos (documento, prazo, encargos), perfil, termo, tipo de equipamento, checklist, reajuste | ⬜ (o servidor já devolve `campos`) |
| Estoque / Compras | Lançar estoque, preço de venda, devolução, pedido de compra, importar/conciliar nota | ◐ / ⬜ |
| Equipamento / Veículo | Equipamento (abas), cadastro por foto, veículo (abas), checklists, CRLV | ◐ / ⬜ |
| Financeiro / Fiscal | Conta a pagar, conta a receber, baixas/boleto (≈15 diálogos), renegociar, lote, recorrência, faturar | ◐ / ⬜ |
| Financeiro / Fiscal | Dados fiscais, NFS-e | ◐ / ⬜ |
| Configurações | Empresa e Preferências | ✅ |
| Configurações | Admissão, comissões, padrões de orçamento | ◐ |
| Configurações | E-mail, Inter, QR, checklist diário, modelos, numeração, horário, impressão, portal, módulos | ⬜ |
| Login / senha | Login do painel | ✅ |
| Login / senha | Esqueci, definir e troca obrigatória de senha | ✅ |
| Login / senha | Meu perfil (Dados e Segurança) | ✅ |
| Super admin | Empresas (a API já mandava `campo`) | ⬜ |
| Documentação da equipe | Novo envio | ◐ |

### Portal do cliente

| Formulário | Padrão |
|---|---|
| Login, esqueci, definir e trocar senha | ✅ |
| Novo chamado | ✅ |
| Pedido de compra | ⬜ |

### Páginas públicas

| Formulário | Padrão |
|---|---|
| Admissão pelo link (campos de admissão) | ◐ |
| Aprovar/recusar orçamento, aceite da OS, aprovação de relatório/medição, chamado pelo QR, calculadora | ⬜ |

### App do técnico (fora do chat e da execução/pausa)

| Formulário | Padrão |
|---|---|
| Despesas | ✅ |
| Meu perfil e troca de senha (o mesmo `perfil-client`) | ✅ |
| Troca obrigatória de senha | ✅ |
| Cadastro de equipamento em campo, porteiro | ⬜ (abrem de dentro da execução: ficam para quando a outra nuvem liberar) |
| Execução, pausa, checklist, câmera, Meu dia, conversa | fora desta leva (outras nuvens) |

### Rotas da API

- Devolvem `{ erro, campos }` nas recusas de campo: clientes, colaborador e acesso ao app, contrato, orçamento, OS (nova,
  editar, atraso, aceitar solicitação), cadastros, empresa, configurações, perfil e senhas (painel e portal) e chamado do portal.
- Outras 30 rotas trocaram só a recusa do zod pelo `erroDeValidacao`, mantendo `detalhes` e ganhando `campos`:
  - veículos, unidades, QR, pedidos de compra, medições, formulários, equipes, equipamentos;
  - contas a receber/pagar, checklists, preferências, contatos/interações/comunicação do cliente.
- O resto continua com `{ erro }` (e `detalhes`), que a tela já entende.

## Para o 2º PR

1. **Telas ⬜ da tabela acima**, por ordem de uso:
   - atividades e visitas da OS, agendar no calendário, gerar OS;
   - orçamento da OS e medição: basta passar `nome` à `ItensTabela`;
   - conta a pagar/receber e as baixas;
   - equipamento e veículo;
   - os editores de cadastro (tabela de preço, kit, modelos…);
   - as outras configurações;
   - pedido de compra do portal e as páginas públicas.
2. **Vínculo de outra empresa no campo.** `respostaRefEmpresa` (`lib/ref-empresa.ts`) devolve só `{ erro }`: cliente, serviço,
   cargo ou perfil de outra empresa ainda caem na faixa. Passar o nome do campo pelo `validarRefEmpresa`.
3. **`ComboboxCodigo`** (código do serviço no cadastro): o erro some ao escolher, mas o combobox ainda não fica vermelho nem
   recebe o aria do campo.
4. **Seletor com cadastro rápido dentro de `Controller`** (contrato): o foco chega nele, mas o `<label for>` não aponta para o
   gatilho.
5. **Foto do colaborador e foto do chamado do portal:** o erro aparece no lugar, mas o "Adicionar" ainda é um `input` escondido.
   Virar um botão que recebe o foco.
6. **`EdicaoNoContextoModal` e `CadastroRapidoModal`** (componentes compartilhados): ainda faixa própria; os campos faltando
   ficam com a borda vermelha, mas sem a mensagem abaixo.
7. **Super admin › Empresas:** a API já manda `campo`; a tela ainda ignora.
8. **Rotas** que ainda montam o erro à mão (`issues[0].message` sem `campos`, ≈56): trocar por `erroDeValidacao`
   rota a rota, junto com a tela de cada uma.

## Testes

- **Regras puras:** `erro-campo-regras`:
  - resumo da faixa e "N campos para corrigir";
  - leitura da API (`campos` e `detalhes`);
  - helpers do servidor;
  - formatos;
  - abas;
  - react-hook-form.
- **O mecanismo na tela:** `erro-campo-ui`:
  - campo marcado com aria e mensagem abaixo, sem o rótulo mudar de cor;
  - faixa como resumo;
  - foco no 1º erro e aba que abre sozinha com o ponto vermelho;
  - erro que some ao corrigir;
  - formato só ao sair;
  - erro do servidor no campo;
  - seletor com busca, data e data e hora.
- **Por formulário:** `erro-campo-{cliente,colaborador,contrato,orcamento,os,cadastros,configuracoes,login,portal}-ui`.
- **Servidor com PostgreSQL real:** `erro-campo-cliente-pg` e `erro-campo-cadastros-pg`.
- **Atualizados de propósito** (afirmavam o comportamento antigo):

| Teste | O que mudou |
|---|---|
| `leva-j-colaborador-ui` | O ícone "Tem erro" da aba virou o ponto com a contagem. |
| `contrato-form-ui` | A frase global "Verifique o prazo… na aba" virou a faixa-resumo + o indicador da aba. |
| `prazos-pr2-ui` | Um erro por vez na faixa → todos de uma vez, cada um no seu campo. |
| `acabamento-hora-ui` | A trava aceita a hora ruim no próprio campo; continua sem salvar. |
| `tecnico-trocar-senha` | A resposta ganhou `campos.senhaAtual`. |
| `janeiro-app-ui` | A troca obrigatória usa o `Input` compartilhado. |
| `app-campo-leva2-despesas-ui` | O valor só acusa ao sair do campo. |
| `estoque-nota-compra-financeiro-pg`, `leva-estoque-e32` | O nome repetido ganhou `campos.nome`. |
