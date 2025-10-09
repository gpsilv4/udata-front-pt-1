from udata.harvest.backends.dcat import DcatBackend


class DcatSkipHeadBackend(DcatBackend):
    display_name = 'DCAT (Skip HEAD)'

    def get_format(self):
        # Assuming json-ld, since we cannot detect it via HEAD request
        # and the URL for DGPJ has JSON in it.
        return 'json-ld'