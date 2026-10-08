# Multiplayer na nuvem

O servidor entrega o jogo, os perfis HTTP e o WebSocket na **mesma origem HTTPS**, por exemplo `https://jogo.exemplo.com`. O navegador usa `wss://jogo.exemplo.com` automaticamente. A demonstração no GitHub Pages continua sendo single-player estático; para multiplayer, compartilhe o endereço do servidor com todos os participantes.

O projeto usa **uma instância Node.js**. Salas, partidas e tokens de reconexão ficam em memória; perfis e progresso verificado ficam em SQLite. Reiniciar a instância encerra as partidas em andamento. Não configure réplicas, autoscaling horizontal, balanceamento entre processos ou múltiplos servidores sobre o mesmo banco. A arquitetura atual não compartilha salas entre instâncias.

## Começar gratuitamente: Render experimental

O arquivo [render.yaml](../render.yaml) descreve somente um Web Service Docker de plano `free`, em `virginia`, sem banco gerenciado, disco pago ou outros recursos. Nenhum recurso é criado apenas por guardar esse arquivo no repositório. A configuração usa a branch `codex/frota-estelar-evolucao` e desativa novos deploys automáticos.

[Configurar essa branch no Render](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fsabedoriameditativa-ops%2Ffantastic-fortnight%2Ftree%2Fcodex%2Ffrota-estelar-evolucao) abre o fluxo oficial de criação na sua conta; confira plano e recursos antes de confirmar. O [formato oficial do botão](https://render.com/docs/deploy-to-render) aceita a URL do repositório com `/tree/branch`.

Passos no painel do provedor:

1. Crie sua conta no [Render](https://render.com/) e conecte o repositório GitHub.
2. Em **New → Blueprint**, selecione o repositório e a branch `codex/frota-estelar-evolucao`. Confirme que a proposta contém apenas o serviço **Free**, sem recursos pagos, antes de iniciar.
3. Depois do primeiro deploy, abra a URL HTTPS fornecida pelo Render. No serviço, defina `FE_PUBLIC_ORIGIN` com essa origem exata, sem `/` no final, e mantenha `FE_COOKIE_SECURE=1`. Aplicar a variável reinicia o serviço.
4. Confira `/health`: deve retornar `ok: true` e `capabilities.profilePersistence: "ephemeral"`. Abra o jogo em dois navegadores, crie uma sala e entre pelo código antes de compartilhar o endereço.
5. Para publicar novas versões, faça deploy manual da branch configurada. Cada deploy pode apagar os perfis dessa instalação gratuita.

**Essa opção é uma demonstração multiplayer, não hospedagem de produção com persistência garantida.** Segundo a documentação do Render consultada em 8/10/2026:

- O plano gratuito suspende o serviço após 15 minutos sem tráfego recebido, incluindo mensagens WebSocket recebidas. O próximo acesso pode levar cerca de um minuto para reativá-lo.
- O sistema de arquivos é efêmero: SQLite, perfis, pontos e desbloqueios dessa instalação podem desaparecer em suspensão, restart ou deploy. O cookie no navegador não recupera um banco apagado. `FE_EPHEMERAL_DATA=1` informa essa limitação à interface via `/health`.
- Não há disco persistente no Web Service gratuito. O Postgres gratuito do Render expira após 30 dias e não é um substituto direto para este SQLite; o Blueprint não cria esse banco.
- Há 750 horas gratuitas por workspace/mês e limites de tráfego e build. Serviços podem ser suspensos ao atingir limites. Confira a cobrança no painel antes de adicionar forma de pagamento ou alterar planos.
- A lista atual de regiões não inclui Brasil. Virginia é uma escolha inicial para experimentar a partir do Brasil, sem garantia de latência; jogadores de outros países também podem conectar. Hospedagem futura em São Paulo precisa de provedor/região que a ofereça.
- O plano gratuito tem recursos limitados. O Blueprint permite **uma sala simultânea** e mantém os limites de proteção. Isso não comprova capacidade para uma partida 6v6 cheia no hardware gratuito; meça antes de aumentar a carga.

O Blueprint não declara os proxies internos do Render confiáveis: ainda é necessário verificar oficialmente quais peers podem encaminhar o IP do cliente. Sem isso, os limites por IP agrupam conexões atrás do mesmo proxy (16 sockets e 32 novos perfis/minuto por endereço observado). Dois usuários legítimos podem compartilhar essa cota; não resolva isso confiando em qualquer `X-Forwarded-For`. O limite global de uma sala permanece ativo.

Fontes oficiais: [instâncias gratuitas](https://render.com/docs/free), [regiões](https://render.com/docs/regions), [WebSockets](https://render.com/docs/websocket), [Blueprint](https://render.com/docs/blueprint-spec).

## Imagem portátil com SQLite durável

A imagem fixa Node.js 24.19.0, instala apenas dependências de execução pelo lockfile e roda sem root. Não inclui testes, artefatos, credenciais nem dados locais. O servidor escuta em `0.0.0.0:3000` e guarda o banco em `/data`.

```sh
docker build -t frota-estelar:local .
docker volume create frota-estelar-data
docker run -d --name frota-estelar \
  --restart unless-stopped --stop-timeout 10 \
  -p 127.0.0.1:3000:3000 \
  -v frota-estelar-data:/data \
  -e FE_COOKIE_SECURE=1 \
  -e FE_PUBLIC_ORIGIN=https://jogo.exemplo.com \
  -e MAX_ROOMS=1 \
  frota-estelar:local
```

Em rede corporativa com CA adicional já confiável, o build aceita `docker build --secret id=npm_ca,src=/caminho/ca.pem -t frota-estelar:local .`. Esse certificado só é montado durante `npm ci`, não permanece na imagem final. Não desative a verificação TLS.

Este comando pressupõe um proxy HTTPS no mesmo host; substitua o domínio e configure seu certificado/TLS. A porta 3000 fica acessível apenas em loopback do host. O volume Docker recebe as permissões do diretório `/data` da imagem. Se optar por bind mount, prepare antes uma pasta gravável pelo UID/GID 1000 do usuário `node`; não abra permissões de leitura pública do banco. Em hospedagem gerenciada, confirme que o volume realmente sobrevive à substituição de instância e não marque armazenamento efêmero como durável.

O proxy deve preservar o cabeçalho `Host`, encaminhar Upgrade/Connection para WebSocket e aplicar um timeout adequado a conexões longas. Não crie um backend HTTP público alternativo que contorne o proxy. Aplicação e WebSocket devem usar o mesmo domínio, porta pública e esquema seguro. Não use o parâmetro `?ws=` para ligar uma página pública a outro domínio: credenciais e proteção de origem exigem a origem do próprio jogo.

Exemplo do bloco de encaminhamento em um virtual host Nginx **já configurado com HTTPS**, com a variável `$connection_upgrade` definida por `map $http_upgrade $connection_upgrade { default upgrade; '' close; }` no contexto `http`:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 3600s;
}
```

Para que limites por IP distingam jogadores, configure `FE_TRUSTED_PROXIES` com os IPs/CIDRs exatos dos proxies que conectam ao Node. Em Docker, o endereço observado pode ser o gateway da rede, não `127.0.0.1`; verifique a topologia antes de habilitar confiança. Um proxy de borda deve substituir cabeçalhos enviados pelo visitante, como no exemplo. Se houver vários proxies, cada um deve acrescentar corretamente o peer que observou, e todos os hops confiáveis precisam constar na configuração. Não use `0.0.0.0/0`, `::/0` ou redes inteiras sem controle exclusivo dos hosts. Cabeçalhos de IP vindos de peers não confiáveis são ignorados; a cadeia válida é percorrida da direita para a esquerda até o primeiro endereço não confiável.

`X-Forwarded-Proto` e `X-Forwarded-Host` nunca habilitam HTTPS ou escolhem a origem das credenciais. Isso é configurado explicitamente. Navegadores de outra origem são rejeitados antes da autenticação WebSocket; clientes nativos sem `Origin` continuam permitidos.

## Configuração e operação

| Variável | Uso |
| --- | --- |
| `HOST`, `PORT` | Interface e porta internas; imagem usa `0.0.0.0`, `3000`. O provedor pode fornecer `PORT`. |
| `FE_DATA_DIR` | Diretório do SQLite; na imagem, `/data`. Requer volume para persistência entre substituições. |
| `FE_EPHEMERAL_DATA=1` | Publica aviso de perfis temporários; não fornece backup nem torna o disco durável. |
| `FE_COOKIE_SECURE=1` | Cookie `Secure` e origem HTTPS esperada atrás do proxy TLS. |
| `FE_PUBLIC_ORIGIN` | Origem pública exata, por exemplo `https://jogo.exemplo.com`, sem barra final/caminho. HTTPS exige a opção anterior. Se ausente, usa `Host` com o esquema explicitamente configurado. |
| `FE_TRUSTED_PROXIES` | Lista de IPs/CIDRs separada por vírgulas. Padrão: nenhum peer confiável. Configuração inválida impede o startup. |
| `MAX_ROOMS` | Máximo de salas do processo; comece com `1` em hardware pequeno. Padrão do servidor genérico: `50`, não uma promessa de capacidade. |
| `MAX_SOCKETS_PER_IP` | Sockets simultâneos por endereço observado/confiável; padrão `16`. `0` remove a proteção. |
| `MAX_ROOMS_PER_IP` | Salas por endereço criador; padrão `4`. `0` remove a proteção. |

`GET /health` responde apenas depois da abertura do SQLite e do listener, com `ok`, número de salas/sessões, uptime e `capabilities.profilePersistence` (`durable`, `ephemeral` ou `memory`). Não revela IDs de perfil, credenciais nem caminho do banco. O `HEALTHCHECK` Docker consulta esse endpoint. Ele verifica disponibilidade HTTP, não mede capacidade de batalha, disco disponível ou qualidade dos backups.

SIGTERM/SIGINT param novas conexões, encerram salas e WebSockets, permitem uma drenagem curta das requisições e fecham o banco. Requisições incompletas são interrompidas após dois segundos; configure pelo menos dez segundos para o encerramento do container. Deploys e reinícios interrompem partidas; reconexão só recupera a sessão enquanto o mesmo processo continua vivo. O limite global e os limites por IP não substituem a proteção de tráfego/DDoS do provedor.

O perfil é identificado por cookie neste navegador e domínio; não há conta/senha nem recuperação entre dispositivos. Trocar de domínio não migra cookies ou localStorage automaticamente. Guarde backups como dados privados, pois eles contêm hashes das credenciais e histórico dos jogadores.

## Backup e recuperação

SQLite usa WAL. **Não copie somente `profiles.sqlite` enquanto o servidor escreve.** Para uma cópia simples e consistente, pare o container, faça backup de todo o volume privado e depois reinicie. Para backup online, use a API de backup do SQLite e armazene o resultado fora do volume ativo:

```sh
docker exec frota-estelar node --input-type=module -e \
  'import {DatabaseSync,backup} from "node:sqlite"; const db=new DatabaseSync("/data/profiles.sqlite",{readOnly:true}); await backup(db,"/data/profiles.backup.sqlite"); db.close();'
docker cp frota-estelar:/data/profiles.backup.sqlite ./profiles.backup.sqlite
```

Proteja o arquivo copiado, retenha versões fora do servidor e remova a cópia temporária de dentro do volume após exportar. Para restaurar, pare o servidor, preserve uma cópia dos dados atuais, instale o backup como `profiles.sqlite` em um **volume novo e vazio**, ajuste a propriedade para UID/GID 1000 e inicie com esse volume. Não misture WAL/SHM de outra versão do banco. Teste a restauração em instância privada antes de depender do procedimento.

Antes de liberar uma instalação pública, valide no próprio hardware e rede: TLS e cookie Secure, criação/entrada em sala entre redes diferentes, partida 6v6 com 12 clientes, reconexão dentro da mesma instância, reinício com perfil preservado quando houver volume durável e restauração de backup. Os testes locais demonstram funcionamento, não latência ou capacidade de um plano remoto ainda não provisionado.
