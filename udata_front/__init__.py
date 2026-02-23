"""
udata customizations for dados.gov
"""

__version__ = "6.2.4"
__description__ = "udata customizations for dados.gov"

import os
import io
import logging
from datetime import datetime

# Imports necessários para o Monkeypatch
try:
    from flask import request
    from udata.core.dataset.models import Checksum, CHECKSUM_TYPES
    from udata.core.storages import api as storage_api
    from udata.core import storages
    from udata.core.dataset.api import UploadMixin
    from udata.api import api
    from udata_front.security import sanitize_svg, sanitize_xml

    log = logging.getLogger(__name__)

    def patched_handle_upload(self, dataset):
        """
        Versão corrigida de handle_upload para sanitizar SVGs e XMLs.
        Substitui o método original para permitir ficheiros seguros.
        """
        # 1. Sanitização antes do processamento pelo udata
        if "file" in request.files:
            file_storage = request.files["file"]
            filename = getattr(file_storage, "filename", "").lower()
            mimetype = getattr(file_storage, "mimetype", "")

            # Lógica para SVG
            if mimetype == "image/svg+xml" or filename.endswith(".svg"):
                log.info(f"Processando e sanitizando upload de SVG: {filename}")
                try:
                    content = file_storage.read()
                    cleaned_content = sanitize_svg(content)
                    file_storage.stream = io.BytesIO(cleaned_content)
                    file_storage.seek(0)
                except ValueError as e:
                    log.error(f"Segurança: SVG rejeitado {filename}: {e}")
                    api.abort(400, f"Ficheiro SVG rejeitado: {str(e)}")

            # Lógica para XML genérico
            elif mimetype in ("application/xml", "text/xml") or filename.endswith(
                ".xml"
            ):
                log.info(f"Processando e sanitizando upload de XML: {filename}")
                try:
                    content = file_storage.read()
                    cleaned_content = sanitize_xml(content)
                    file_storage.stream = io.BytesIO(cleaned_content)
                    file_storage.seek(0)
                except ValueError as e:
                    log.error(f"Segurança: XML rejeitado {filename}: {e}")
                    api.abort(400, f"Ficheiro XML rejeitado: {str(e)}")
                except Exception as e:
                    log.error(f"Erro Crítico ao sanitizar {filename}: {e}")
                    api.abort(400, "Erro ao processar ficheiro XML.")

        # 2. Chamada direta (bypass) à API de Storage para evitar o bloqueio de SVG do UploadMixin original
        prefix = "/".join((dataset.slug, datetime.utcnow().strftime("%Y%m%d-%H%M%S")))
        infos = storage_api.handle_upload(storages.resources, prefix)

        # 3. Validações Pós-Upload (Replicado do original mas sem bloqueio de SVG)
        if "html" in infos["mime"]:
            api.abort(415, "Incorrect file content type: HTML")

        # Configurar metadados (Título, Checksum, Tamanho)
        infos["title"] = os.path.basename(infos["filename"])

        # Lógica de Checksum (original do udata)
        checksum_type = next(
            checksum_type for checksum_type in CHECKSUM_TYPES if checksum_type in infos
        )
        infos["checksum"] = Checksum(type=checksum_type, value=infos.pop(checksum_type))
        infos["filesize"] = infos.pop("size")
        del infos["filename"]

        return infos

    # Aplicar o Monkeypatch
    UploadMixin.handle_upload = patched_handle_upload
    log.info("Monkeypatch aplicado: UploadMixin.handle_upload agora sanitiza SVGs.")

except ImportError as e:
    # Caso udata não esteja instalado (ex: durante build de assets), ignoramos silenciosamente
    pass
