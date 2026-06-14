from src.services.og_activity.contract import ContractType
from src.services.og_activity.kb_ingest import artifact_to_contracts


def test_body_md_maps_to_markdown_dynamic_page():
    artifact = {
        "id": "art-1",
        "name": "Permitting 101",
        "summary": "intro",
        "sourceSha": "sha-1",
        "skillUsed": "cs-enablement",
        "bodyMd": "# Heading\n\nBody text.",
    }
    contracts = artifact_to_contracts(artifact)
    assert len(contracts) == 1
    c = contracts[0]
    assert c.type is ContractType.DYNAMIC_PAGE
    assert c.title == "Permitting 101"
    assert c.summary == "intro"
    assert c.payload == {"markdown": "# Heading\n\nBody text."}
    assert c.source.origin == "kb"
    assert c.source.kb_id == "art-1"
    assert c.source.kb_sha == "sha-1"
    assert c.source.skill_used == "cs-enablement"


def test_attachments_map_to_documents_with_distinct_kb_ids():
    artifact = {
        "id": "art-2",
        "name": "Release Notes",
        "sourceSha": "sha-2",
        "bodyMd": "body",
        "attachments": [
            {"fileRef": "files/guide.pdf", "mime": "application/pdf", "name": "Guide"},
            {"url": "https://x/y.docx"},  # mime + name missing -> defaults
        ],
    }
    contracts = artifact_to_contracts(artifact)
    types = [c.type for c in contracts]
    assert types == [ContractType.DYNAMIC_PAGE, ContractType.DOCUMENT, ContractType.DOCUMENT]

    doc1, doc2 = contracts[1], contracts[2]
    assert doc1.payload == {"file_ref": "files/guide.pdf", "mime": "application/pdf"}
    assert doc1.title == "Guide"
    assert doc1.source.kb_id == "art-2:files/guide.pdf"  # distinct from the page's kb_id
    assert doc2.payload == {"file_ref": "https://x/y.docx", "mime": "application/octet-stream"}
    assert doc2.source.kb_id == "art-2:https://x/y.docx"
    assert doc2.title == "https://x/y.docx"


def test_blank_body_md_produces_no_page():
    artifact = {"id": "art-3", "name": "Empty", "bodyMd": "   ", "sourceSha": "s"}
    assert artifact_to_contracts(artifact) == []


def test_attachment_without_file_ref_is_skipped():
    artifact = {"id": "a", "name": "n", "bodyMd": "b", "attachments": [{"mime": "application/pdf"}]}
    contracts = artifact_to_contracts(artifact)
    assert [c.type for c in contracts] == [ContractType.DYNAMIC_PAGE]


def test_artifact_without_id_returns_empty():
    assert artifact_to_contracts({"name": "no id", "bodyMd": "body"}) == []
