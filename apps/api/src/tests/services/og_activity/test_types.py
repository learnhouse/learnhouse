from types import SimpleNamespace

import pytest

from src.db.courses.activities import ActivityTypeEnum, ActivitySubTypeEnum
from src.services.og_activity.contract import ContractType
from src.services.og_activity.registry import get_module, _REGISTRY
from src.services.og_activity.types import register_builtin_types


@pytest.fixture(autouse=True)
def _register_builtins():
    # Register here (not via import side-effect) so other test files that
    # clear the global registry can't leave it empty for these tests.
    _REGISTRY.clear()
    register_builtin_types()
    yield


def test_dynamic_page_to_learnhouse():
    module = get_module(ContractType.DYNAMIC_PAGE)
    payload = module.validate({"blocks": [{"type": "paragraph"}]})
    spec = module.to_learnhouse(payload)
    assert spec.activity_type is ActivityTypeEnum.TYPE_DYNAMIC
    assert spec.activity_sub_type is ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE
    assert spec.content == {"type": "doc", "content": [{"type": "paragraph"}]}


def test_dynamic_page_round_trip():
    module = get_module(ContractType.DYNAMIC_PAGE)
    activity = SimpleNamespace(content={"type": "doc", "content": [{"type": "paragraph"}]})
    assert module.from_learnhouse(activity) == {"blocks": [{"type": "paragraph"}]}


def test_document_pdf_to_learnhouse():
    module = get_module(ContractType.DOCUMENT)
    payload = module.validate({"file_ref": "files/guide.pdf", "mime": "application/pdf"})
    spec = module.to_learnhouse(payload)
    assert spec.activity_type is ActivityTypeEnum.TYPE_DOCUMENT
    assert spec.activity_sub_type is ActivitySubTypeEnum.SUBTYPE_DOCUMENT_PDF
    assert spec.content == {"filename": "files/guide.pdf", "mime": "application/pdf"}


def test_document_non_pdf_uses_doc_subtype():
    module = get_module(ContractType.DOCUMENT)
    payload = module.validate(
        {"file_ref": "files/x.docx", "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
    )
    spec = module.to_learnhouse(payload)
    assert spec.activity_sub_type is ActivitySubTypeEnum.SUBTYPE_DOCUMENT_DOC


def test_both_types_registered():
    assert ContractType.DYNAMIC_PAGE in _REGISTRY
    assert ContractType.DOCUMENT in _REGISTRY
