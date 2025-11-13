##########################################
# Dockerfile for udata
##########################################

# Baseia-se na imagem oficial Python 3.11 no Debian Bookworm (mais recente e com correções de segurança)
FROM python:3.11-slim-bookworm

# Argumentos opcionais de build para metadados da imagem
ARG REVISION="N/A"
ARG CREATED="Undefined"

# Anotações OCI para descrever a imagem
LABEL "org.opencontainers.image.title"="udata all-in-one"
LABEL "org.opencontainers.image.description"="udata with all known plugins and themes"
LABEL "org.opencontainers.image.authors"="Open Data Team"
LABEL "org.opencontainers.image.sources"="https://github.com/opendatateam/docker-udata"
LABEL "org.opencontainers.image.revision"=$REVISION
LABEL "org.opencontainers.image.created"=$CREATED

# Atualiza a lista de pacotes e instala as dependências necessárias.
# A ordem é importante para evitar conflitos de dependência.
# Usamos --no-install-recommends para manter a imagem mais pequena.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    # testar certificados SSL (validar ligações HTTPS para o Hydra)
    ca-certificates \
    build-essential \
    libpcre3-dev \
    mime-support \
    libxmlsec1 \
    libxmlsec1-dev \
    xmlsec1 \
    libgnutls28-dev \
    libssl-dev \
    netcat-openbsd \
    # --- NOVAS DEPENDÊNCIAS PARA NGINX E SUPERVISOR ---
    nginx \
    supervisor \
    # ---------------------------
    # Limpeza de caches e ficheiros temporários
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Garante que pip está atualizado
RUN pip install --upgrade pip

# Copia e instala as dependências Python dos ficheiros requirements
COPY requirements/install.pip /tmp/requirements/install.pip
COPY requirements.pip /tmp/requirements.pip
RUN pip install -r /tmp/requirements.pip && pip check || pip install -r /tmp/requirements.pip

# Força a atualização das bibliotecas de rede e criptografia para as suas
# versões mais recentes. Isto é crucial para corrigir bugs de corrupção
# de memória (ex: "double free" / "signal 6") vistos nos logs.
RUN pip install --upgrade requests urllib3 pyopenssl cryptography

# Copia o código fonte da aplicação udata e instala-o
COPY . /tmp/udata_app_source/
RUN pip install -e /tmp/udata_app_source/

# Criação de diretórios necessários dentro do container
# --- ADICIONADO DIRETÓRIOS PARA SOCKET, LOGS DO SUPERVISOR E NGINX ---
RUN mkdir -p /udata/fs /src /var/run/uwsgi /var/log/supervisor /var/log/nginx

# Copia o ficheiro de configuração, ficheito de variáveis de ambiente e o script de entrada para o container
COPY udata.cfg entrypoint.sh .env /udata/

# Garante que o script entrypoint.sh é executável
RUN chmod +x /udata/entrypoint.sh

# Copia os ficheiros de configuração uWSGI
COPY uwsgi/*.ini /udata/uwsgi/

# --- COPIA AS CONFIGURAÇÕES DO SUPERVISOR E NGINX ---
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY nginx-udata.conf /etc/nginx/sites-enabled/default
# -------------------------------------

# Define o diretório de trabalho padrão dentro do container
WORKDIR /udata

# Declara o diretório /udata/fs como um volume para persistência de dados
VOLUME /udata/fs

# Define a variável de ambiente para o caminho do ficheiro de configurações do udata
ENV UDATA_SETTINGS=/udata/udata.cfg

# Força o Python a usar o código-fonte montado em /src/gouvfr,
# resolvendo os conflitos de importação no entrypoint.
ENV PYTHONPATH="/src/gouvfr:${PYTHONPATH}"
# ---------------------------

# Expõe a porta 7000 do container
EXPOSE 7000

# O entrypoint.sh será chamado pelo Supervisor para iniciar o uWSGI
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]