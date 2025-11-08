# Mapa de Horários Acadêmicos

Aplicação front-end simples para construir cronogramas semanais de cursos.

## Como usar

1. Acesse `http://localhost:3000` (após iniciar o servidor) em um navegador moderno (Chrome, Edge, Firefox).
2. Utilize o menu de ícones à esquerda (basta passar o mouse ou focar para expandir) para abrir o painel de cadastros de períodos, docentes, salas, disciplinas ou configurações. Cada painel permite adicionar, buscar, editar e remover itens conforme necessário.
3. Ao cadastrar disciplinas é possível informar um código opcional, que é validado para evitar duplicidade. A aplicação sugere automaticamente uma cor distinta para cada disciplina dentro do período selecionado, mas você pode ajustá-la pelo seletor exibido no formulário (a escolha é mantida nas listas, no mapa e nos dados exportados).
4. Defina também, se desejar, a quantidade prevista de horários para cada disciplina. A lista de disciplinas destaca cargas pendentes ou excedentes e as células excedentes do mapa recebem um alerta visual.
5. No cadastro de docentes você pode, opcionalmente, vincular um docente a várias disciplinas utilizando o seletor com os botões **+** e **−**, além de marcar se ele pertence à área específica do curso. Essas informações alimentam as sugestões exibidas no modal de atribuição, mas continuam totalmente opcionais para manter flexibilidade.
6. Use o ícone de controles logo abaixo do menu (a barra lateral de visualização) para escolher a visão — por período, docente ou sala — e o item desejado. O painel de resumo acima da grade apresenta dados da seleção atual:
   * **Período** – lista todas as disciplinas daquele período com os docentes atribuídos, horários no formato M1, M2, etc., e o status da carga prevista (faltando, completa ou excedida).
   * **Docente** – informa o total de aulas e de horas configuradas, destaca as disciplinas vinculadas e detalha em quais períodos e horários o docente está alocado.
   * **Sala** – mostra a porcentagem de ocupação semanal da sala e todas as reservas agrupadas por horário, identificando rapidamente eventuais conflitos no mesmo bloco.

7. Clique em um bloco do cronograma para atribuir/editar uma disciplina. Ative a seleção múltipla para marcar vários horários ao mesmo tempo e aplicar a mesma configuração para todos, inclusive substituindo lançamentos existentes quando desejar. As células preenchidas exibem a disciplina com sua cor dedicada e os dias da semana permanecem fixos no topo para facilitar a navegação. Use os botões **Editar seleção** e **Limpar** para confirmar ou desfazer a seleção em lote.
8. Para reposicionar rapidamente um horário já configurado, clique e arraste o bloco desejado em qualquer visão (período, docente ou sala). As células compatíveis ficam verdes e as incompatíveis vermelhas conforme você move o mouse; a movimentação só é concluída quando o novo horário estiver livre para o período, sala e docente envolvidos.
9. O painel de edição sugere docentes e salas livres naquele horário, indicando com destaque os docentes vinculados à disciplina escolhida e sinalizando quando o docente pertence à área do curso; conflitos continuam sendo validados ao salvar seleções múltiplas.
10. Utilize a seção **Configurações** para nomear o planejamento atual e clicar em **Salvar configuração**. A lista abaixo é carregada do servidor e permite abrir, exportar ou remover cronogramas diretamente pelo painel (use **Atualizar lista** sempre que quiser sincronizar o conteúdo com outras pessoas ou abas).
11. Ainda nas configurações, mantenha um rascunho rápido no navegador com os botões de salvar/recarregar, exporte um JSON da versão atual ou importe arquivos salvos anteriormente — o conteúdo importado é carregado imediatamente, gravado no servidor com o nome informado (ou com o carimbo de data e hora da importação) e também mantém o rascunho local atualizado.

O cronograma em edição continua sendo preservado automaticamente no armazenamento local do navegador para facilitar rascunhos rápidos. As configurações nomeadas, porém, passam a ser guardadas no servidor e ficam disponíveis para qualquer pessoa que acesse a mesma instância da aplicação.

## Executando o servidor

1. Com o Node.js instalado, execute `npm start` na pasta do projeto. O servidor integrado não possui dependências externas e inicializa diretamente com `node server.js`.
2. A interface web e os endpoints REST ficam disponíveis em `http://localhost:3000`.
3. Os cronogramas nomeados são gravados no arquivo `data/configurations.json` (criado automaticamente caso não exista). É possível fazer backup manual deste arquivo ou versioná-lo de acordo com a sua necessidade.

### Persistência de dados

A aplicação combina dois mecanismos de armazenamento:

* **Rascunho local** – o estado atual permanece no `localStorage` do navegador, permitindo continuar de onde parou mesmo sem salvar no servidor.
* **Biblioteca no servidor** – cada configuração nomeada é enviada para a API e fica disponível na lista de configurações, podendo ser carregada, sobrescrita, exportada ou removida pela interface.
