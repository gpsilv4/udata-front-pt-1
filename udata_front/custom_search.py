from udata.core.dataset.search import DatasetSearch, BoolFilter
from udata.core.dataset.models import Dataset
from udata.core.dataset.api import DatasetApiParser, DEFAULT_SORTING
from udata.models import db

class CustomDatasetSearch(DatasetSearch):
    filters = {
        **DatasetSearch.filters,
        "hvd": BoolFilter(),
    }

    @classmethod
    def mongo_search(cls, args):
        datasets = Dataset.objects.visible()
        datasets = DatasetApiParser.parse_filters(datasets, args)

        if args.get("hvd"):
            hvd_filter_value = args["hvd"].lower()
            if hvd_filter_value == "true":
                datasets = datasets.filter(extras__hvd="true")
            elif hvd_filter_value == "false":
                datasets = datasets.filter(db.Q(extras__hvd__ne="true") | db.Q(extras__hvd__exists=False))

        sort = (
            cls.parse_sort(args["sort"])
            or ("$text_score" if args["q"] else None)
            or DEFAULT_SORTING
        )
        return datasets.order_by(sort).paginate(args["page"], args["page_size"])
