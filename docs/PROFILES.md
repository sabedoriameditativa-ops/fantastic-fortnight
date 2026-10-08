# Perfis, progresso e frotas

`npm start` usa SQLite no próprio servidor, sem contas ou serviços externos. Por padrão, `profiles.sqlite` fica na pasta `frota-estelar-data` ao lado do checkout; `FE_DATA_DIR` escolhe outro diretório persistente. O servidor requer Node 24 para o suporte nativo a SQLite usado aqui. Dados pessoais e arquivos SQLite não são servidos pelo servidor de arquivos estáticos.

Cada navegador recebe uma identidade privada por cookie `HttpOnly`, `SameSite=Strict`, com 32 bytes aleatórios; o banco guarda somente o hash do autenticador. O JavaScript não recebe esse autenticador, e ele nunca entra em URLs ou mensagens do jogo. Em HTTPS direto, o cookie recebe `Secure`; atrás de um proxy HTTPS, configure `FE_COOKIE_SECURE=1`. Não publique o servidor em HTTP aberto. Não existe recuperação de conta, sincronização entre dispositivos nem login global: apagar o cookie perde o acesso a esse perfil. Alterar o servidor ou seu domínio também muda o perfil disponível. Reiniciar o servidor preserva o perfil quando o diretório de dados é persistente.

Conexões WebSocket de navegadores exigem a mesma origem da página: protocolo HTTP/HTTPS, domínio e porta precisam coincidir com o servidor. A verificação acontece antes de autenticar cookies ou tokens, inclusive entre portas ou subdomínios do mesmo site. Um parâmetro `ws` apontando para outra origem é recusado. Para proxy HTTPS, use `FE_COOKIE_SECURE=1` (ou `startServer({ secure: true })`) e preserve o cabeçalho `Host` público; cabeçalhos `X-Forwarded-*` não alteram essa política. Clientes nativos de teste ou CLI podem omitir `Origin`.

A biblioteca de frotas, preferências e progresso antigo continuam locais neste navegador. A primeira leitura da biblioteca importa a última frota uma vez, sem apagar o original. É possível manter até 40 modelos, nomear, duplicar, comparar e reutilizar; o plano de formação acompanha a frota. Falhas de quota são informadas e preservam o registro anterior. O progresso antigo da campanha pode ser copiado para o perfil do servidor como **não verificado**; não vira pontos, pois seria indistinguível de dados editados pelo cliente.

## Pontos e perdas

Os valores padrão são conservadores e configuráveis por `FE_PROGRESSION_POLICY`, um objeto JSON com os nomes definidos em `shared/progression.js` (ou a opção `policy` da API de criação do serviço). Campos ausentes ou inválidos mantêm o padrão:

| Regra | Padrão |
| --- | --- |
| Participação em partida concluída | 8 pontos |
| Vitória | +14 |
| Empate | +4 |
| Desempenho | até +6, com contribuição relativa ao time, dano efetivo e reparo |
| Derrota | saldo líquido de −2; desempenho muito baixo pode levar a −4 |
| Ganho diário máximo | 180 |
| Perda diária máxima em partidas | 30 |
| Intervalo mínimo entre recompensas | 60 segundos |
| Partida curta sem recompensa | menos de 200 ticks, equivalentes a 10 segundos simulados |
| Carência de inatividade | 14 dias após a última partida elegível concluída |
| Perda de inatividade | −2 por dia completo após a carência, até 40 por ausência |

O saldo nunca fica negativo. Partidas durante o intervalo ainda aparecem no histórico, com zero pontos, e contam como atividade real. Teclas apertadas, tempo de login e visualização do perfil não contam como jogar. As perdas de inatividade são calculadas ao consultar ou modificar o perfil: vários acessos no mesmo dia não cobram novamente. Não há dívida de inatividade. Comprar algo reduz o saldo disponível, sem apagar o total histórico de pontos ganhos.

Licenças de piloto custam 80 pontos. As quatro facções originais e suas naves continuam acessíveis. O Concílio Astral custa 180 e inclui sua Lanceta; Guardião custa 120 e Arconte 180 adicionais. Sua licença de piloto custa 80 e requer a facção. Todos os desbloqueios são permanentes. As compras liberam opções, sem elevar atributos, orçamento ou limites. A nave pilotável reserva 200 pontos do orçamento de combate. O servidor também valida essas permissões nas frotas multiplayer e nas partidas single-player verificadas.

## Verificação dos resultados

No multiplayer, somente o resultado real da simulação do servidor gera histórico e pontos. O identificador de partida e os participantes são capturados ao iniciar; reconexões não concedem novas recompensas. Resultados produzidos após erro de simulação são excluídos. Um mesmo perfil presente nos dois times não recebe recompensa nessa partida.

No single-player verificado, o servidor escolhe a semente e constrói a configuração. O cliente roda essa configuração no Worker local; ao terminar, envia apenas o identificador da partida e, quando há piloto, o registro dos comandos aceitos. O servidor executa novamente a simulação em um Worker separado e calcula o próprio resultado. Não recebe pontuação, dano, posição ou vencedor como autoridade. O registro de piloto tem limites de tamanho, sequência, tempo e frequência; movimento, tiro e habilidades passam pelas mesmas regras autoritativas da simulação. Uma tentativa já verificada não pode trocar seu registro de comandos.

Há no máximo dois verificadores simultâneos, prazo de 20 segundos por verificação e 64 partidas abertas no serviço. Cada perfil mantém uma partida aberta por até uma hora. Repetir a mesma configuração retoma a semente já criada; trocar de frota ou missão após o intervalo de 60 segundos abandona a anterior, sem pontos. Falha de conexão, indisponibilidade do verificador e partidas com semente explícita permitem treino local, que mantém o progresso local e não concede pontos de servidor. Essas restrições reduzem exploração sem exigir serviços externos; não equivalem a um sistema competitivo com identidades humanas verificadas.

A licença do piloto é conferida antes de montar as frotas adversárias. Cada partida admite no máximo três inícios de verificação, separados por cinco segundos. Replays inválidos já analisados são rejeitados pelo resultado salvo, sem repetir a simulação; mudar o conteúdo não contorna o teto. Reenvios simultâneos idênticos compartilham uma verificação, e resultados verificados continuam disponíveis para confirmação sem consumir tentativas. Os contadores e as rejeições persistem no SQLite, inclusive após reinício. A atualização adiciona apenas as tabelas e colunas ausentes, preservando perfis, histórico e desbloqueios existentes.

O histórico exibe as últimas 50 partidas por perfil. Recompensas usam transações SQLite e chave única `(perfil, partida)`, tornando a aplicação idempotente mesmo se a confirmação for repetida. Os registros antigos permanecem no banco para essa proteção. Mantenha cópias de segurança privadas do diretório de dados; para uma cópia simples, pare o servidor e copie o diretório inteiro, incluindo arquivos auxiliares do SQLite.

## Testes

`node --test test/server/profiles.test.js test/client/profile.test.js test/client/fleetLibrary.test.js test/client/storage.test.js`

Cobrem persistência após reabrir o SQLite, privacidade do cookie, origem, idempotência, limites, perdas, desbloqueios, migração sem pontos, cópias sem mutação, falhas de quota e comparação entre a simulação local e a verificação single-player automática e pilotada. A integração multiplayer tem testes adicionais em `test/server`.
