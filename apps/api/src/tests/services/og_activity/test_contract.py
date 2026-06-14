import pytest
from pydantic import ValidationError

from src.services.og_activity.contract import (
    ActivityContract,
    ContractSource,
    ContractType,
    build_provenance,
)


def test_parses_a_full_envelope():
    contract = ActivityContract.model_validate(
        {
            "type": "dynamic_page",
            "title": "Intro to Permitting",
            "summary": "A short lesson",
            "source": {"origin": "kb", "kb_id": "kb-1", "kb_sha": "sha-1"},
            "payload": {"blocks": []},
        }
    )
    assert contract.contract_version == "1.0"
    assert contract.type is ContractType.DYNAMIC_PAGE
    assert contract.source.origin == "kb"
    assert contract.payload == {"blocks": []}


def test_rejects_unknown_type():
    with pytest.raises(ValidationError):
        ActivityContract.model_validate(
            {"type": "not_a_type", "title": "x", "source": {"origin": "manual"}, "payload": {}}
        )


def test_build_provenance_omits_none_and_keeps_origin():
    prov = build_provenance(ContractSource(origin="kb", kb_id="kb-1", kb_sha="sha-1"))
    assert prov == {"source": "kb", "kb_id": "kb-1", "kb_sha": "sha-1"}


def test_build_provenance_manual_origin_only():
    prov = build_provenance(ContractSource(origin="manual"))
    assert prov == {"source": "manual"}
