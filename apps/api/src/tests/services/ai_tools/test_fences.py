"""Rich blocks written as Markdown fences (src/services/ai/tools/fences.py)."""

import pytest
from fastapi import HTTPException

from src.services.ai.tools import doc_ops as d
from src.services.ai.tools import fences
from src.services.ai.tools.markdown import doc_to_markdown, inline, markdown_to_doc


def one(markdown: str) -> dict:
    doc = markdown_to_doc(markdown)
    d.check_loadable(doc)
    assert len(doc["content"]) == 1, doc
    return doc["content"][0]


def strip_ids(value):
    if isinstance(value, dict):
        return {
            k: strip_ids(v)
            for k, v in value.items()
            if k not in ("quizId", "question_id", "answer_id")
        }
    if isinstance(value, list):
        return [strip_ids(v) for v in value]
    return value


def test_quiz_fence_shapes():
    node = one(
        "```quiz\n"
        "Q1: Where does **photosynthesis** happen?\n"
        "- [x] In the chloroplasts\n"
        "- [ ] In the nucleus\n"
        "> Chloroplasts hold the chlorophyll.\n"
        "\n"
        "2. Pick every gas involved\n"
        "(two answers)\n"
        "* [X] CO2\n"
        "[x] O2\n"
        "- [ ] Helium\n"
        "Explanation: both take part.\n"
        "```"
    )
    assert node["type"] == "blockQuiz" and node["attrs"]["quizId"].startswith("quiz_")
    first, second = node["attrs"]["questions"]
    assert (
        first["question"] == "Where does photosynthesis happen?"
        and first["response_type"] == "single"
    )
    assert [(a["answer"], a["correct"]) for a in first["answers"]] == [
        ("In the chloroplasts", True),
        ("In the nucleus", False),
    ]
    assert first["explanation"] == "Chloroplasts hold the chlorophyll."
    assert (
        second["question"] == "Pick every gas involved (two answers)"
        and second["response_type"] == "multiple"
    )
    assert [a["correct"] for a in second["answers"]] == [True, True, False]
    assert second["explanation"] == "both take part."
    assert all(a["answer_id"].startswith("answer_") for a in first["answers"])


@pytest.mark.parametrize(
    "body, problem",
    [
        ("Q: x\n- [ ] a\n- [ ] b", "no correct option"),
        ("- [x] a\n- [ ] b", "before any question"),
        ("Q: x\n- [x] a", "has 1 option"),
        ("Q: x\n" + "".join(f"- [x] {k}\n" for k in range(13)), "has 13 options"),
        ("Q: x\n- [x] a\n- [ ]", "empty option"),
        ("", "no questions"),
        ("Q:\n- [x] a\n- [ ] b", "question 1 has no text"),
    ],
)
def test_quiz_fence_errors(body, problem):
    with pytest.raises(HTTPException) as e:
        markdown_to_doc(f"Intro\n\n```quiz\n{body}\n```")
    assert e.value.status_code == 400
    assert (
        e.value.detail.startswith("In the ```quiz block starting at line 3")
        and problem in e.value.detail
    )


def test_flipcards_fence_shapes():
    single = one("```flipcards\nStomata :: Pores\n```")
    assert single["type"] == "flipcard"
    assert single["attrs"] == {
        "question": "Stomata",
        "answer": "Pores",
        "color": "blue",
        "alignment": "center",
        "size": "medium",
    }
    grid = one(
        "```flipcards\ncolumns: 2\ncolor: green\nsize: large\n- Front one :: Back one\nFront: Two\nBack: Deux\n```"
    )
    assert grid["type"] == "flipcardGrid" and grid["attrs"] == {"columns": 2}
    assert [
        (
            c["attrs"]["question"],
            c["attrs"]["answer"],
            c["attrs"]["color"],
            c["attrs"]["size"],
        )
        for c in grid["content"]
    ] == [
        ("Front one", "Back one", "green", "large"),
        ("Two", "Deux", "green", "large"),
    ]
    auto = one(
        "```flipcards\n" + "\n".join(f"q{k} :: a{k}" for k in range(5)) + "\n```"
    )
    assert auto["attrs"]["columns"] == 3 and len(auto["content"]) == 5
    forced = one("```flipcard\ncolumns: 1\nOnly :: One\n```")
    assert forced["type"] == "flipcardGrid" and forced["attrs"]["columns"] == 1


@pytest.mark.parametrize(
    "body, problem",
    [
        ("just text", "Front :: Back"),
        ("Front: a\nFront: b", "has no back"),
        ("Back: b", "before its Front"),
        ("Front: a", "has no back"),
        ("columns: 9\na :: b", "columns must be"),
        ("color: pink\na :: b", "color must be one of"),
        (" :: b", "needs both a front and a back"),
        ("columns: 2", "no cards"),
    ],
)
def test_flipcards_fence_errors(body, problem):
    with pytest.raises(HTTPException) as e:
        markdown_to_doc(f"```flipcards\n{body}\n```")
    assert problem in e.value.detail


@pytest.mark.parametrize(
    "shared, embed",
    [
        (
            "https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=3",
            "https://www.youtube.com/embed/aqz-KE-bpKQ?rel=0&start=3",
        ),
        ("https://youtu.be/aqz-KE-bpKQ", "https://www.youtube.com/embed/aqz-KE-bpKQ?rel=0"),
        (
            "https://m.youtube.com/shorts/aqz-KE-bpKQ",
            "https://www.youtube.com/embed/aqz-KE-bpKQ?rel=0",
        ),
        (
            "https://www.youtube.com/embed/aqz-KE-bpKQ",
            "https://www.youtube.com/embed/aqz-KE-bpKQ?rel=0",
        ),
        ("https://vimeo.com/123456789", "https://player.vimeo.com/video/123456789"),
        (
            "https://www.loom.com/share/abcdef1234567890",
            "https://www.loom.com/embed/abcdef1234567890",
        ),
        ("https://www.figma.com/embed?url=x", "https://www.figma.com/embed?url=x"),
    ],
)
def test_embed_urls(shared, embed):
    assert fences.embed_url(shared) == embed


def test_embed_fence_shapes_and_errors():
    node = one(
        "```embed\n<https://youtu.be/aqz-KE-bpKQ>\nheight: 500px\nalign: left\n```"
    )
    # Shaped like the editor frames a pasted link; an explicit height wins.
    assert node == {
        "type": "blockEmbed",
        "attrs": {
            "embedUrl": "https://www.youtube.com/embed/aqz-KE-bpKQ?rel=0",
            "embedCode": None,
            "embedType": "url",
            "embedHeight": 500,
            "embedAspectRatio": None,
            "embedWidth": "100%",
            "alignment": "left",
            "embedSourceUrl": "https://youtu.be/aqz-KE-bpKQ",
            "embedProvider": "youtube",
        },
    }
    video = one("```video\nurl: https://vimeo.com/123456789\n```")["attrs"]
    assert video["embedProvider"] == "vimeo" and video["embedAspectRatio"] == 16 / 9
    plain = one("```embed\nhttps://example.org/tool\n```")["attrs"]
    assert plain["embedHeight"] == fences.EMBED_HEIGHT and "embedProvider" not in plain
    for body, problem in [
        ("not a url", "give one http(s) URL"),
        ("ftp://x.test/a", "give one http(s) URL"),
        ("https://a.test\nhttps://b.test", "one URL"),
        ("height: 300", "needs an http(s) URL"),
        ("https://a.test\nheight: 5", "height must be"),
    ]:
        with pytest.raises(HTTPException) as e:
            markdown_to_doc(f"```embed\n{body}\n```")
        assert problem in e.value.detail


def test_button_and_badge_fences():
    button = one(
        "```button\n🧪 [Open the *lab* sheet](https://example.org/lab.pdf)\ncolor: green\nalign: center\n```"
    )
    assert button == {
        "type": "button",
        "attrs": {
            "emoji": "🧪",
            "link": "https://example.org/lab.pdf",
            "color": "green",
            "alignment": "center",
        },
        "content": [{"type": "text", "text": "Open the lab sheet"}],
    }
    plain = one("```button\n[Docs](<https://docs.test/a>)\n```")
    assert plain["attrs"] == {
        "emoji": "🔗",
        "link": "https://docs.test/a",
        "color": "blue",
        "alignment": "left",
    }
    badge = one("```badge\nKey idea\nemoji: ⭐\ncolor: amber\n```")
    assert badge == {
        "type": "badge",
        "attrs": {"color": "amber", "emoji": "⭐"},
        "content": [{"type": "text", "text": "Key idea"}],
    }
    for fence, body, problem in [
        ("button", "hello", "[Label](https://...)"),
        ("button", "color: green", "needs its label and link"),
        (
            "button",
            "[x](http://a.test)\n[y](http://b.test)",
            "cannot read the button line",
        ),
        ("badge", "color: green", "needs its text"),
        ("badge", "x" * 81, "at most 80 characters"),
    ]:
        with pytest.raises(HTTPException) as e:
            markdown_to_doc(f"```{fence}\n{body}\n```")
        assert problem in e.value.detail


def test_fences_round_trip_and_sit_anywhere():
    source = (
        "# Title\n\n"
        "```quiz\nQ: One?\n- [x] a\n- [ ] b\n> because\n\nQ: Two?\n- [x] c\n- [x] d\n- [ ] e\n```\n\n"
        "```flipcards\ncolumns: 2\ncolor: red\nf1 :: b1\nf2 :: b2\n```\n\n"
        "```embed\nhttps://www.youtube.com/embed/aqz-KE-bpKQ\nheight: 320\n```\n\n"
        "```button\n⭐ [Go](https://go.test/x)\ncolor: teal\nalign: right\n```\n\n"
        "```badge\nNote\ncolor: green\nemoji: ✅\n```\n\n"
        "- a list item\n\n  ```quiz\n  Q: Nested?\n  - [x] yes\n  - [ ] no\n  ```\n\n"
        "```python\nprint('still code')\n```\n"
    )
    doc = markdown_to_doc(source)
    d.check_loadable(doc)
    assert [n["type"] for n in doc["content"]] == [
        "heading",
        "blockQuiz",
        "flipcardGrid",
        "blockEmbed",
        "button",
        "badge",
        "bulletList",
        "codeBlock",
    ]
    assert doc["content"][6]["content"][0]["content"][1]["type"] == "blockQuiz"
    text = doc_to_markdown(doc)
    assert "```quiz\nQ: One?\n- [x] a\n- [ ] b\n> because\n\nQ: Two?" in text
    assert "```flipcards\ncolumns: 2\ncolor: red\nf1 :: b1\nf2 :: b2\n```" in text
    assert (
        "```embed\nhttps://www.youtube.com/embed/aqz-KE-bpKQ\nheight: 320\n```" in text
    )
    assert (
        "```button\n⭐ [Go](https://go.test/x)\ncolor: teal\nalign: right\n```" in text
    )
    assert "```badge\nNote\ncolor: green\nemoji: ✅\n```" in text
    assert strip_ids(markdown_to_doc(text)) == strip_ids(doc)


def test_blocks_the_fences_cannot_carry_stay_comments():
    # Mixed card styles, raw embed code, a quiz without a right answer: the
    # comment keeps them exactly as they are.
    mixed = {
        "type": "flipcardGrid",
        "attrs": {"columns": 2},
        "content": [
            {
                "type": "flipcard",
                "attrs": {"question": "a", "answer": "b", "color": "red"},
            },
            {
                "type": "flipcard",
                "attrs": {"question": "c", "answer": "d", "color": "blue"},
            },
        ],
    }
    code_embed = {
        "type": "blockEmbed",
        "attrs": {
            "embedCode": "<iframe src='https://x.test'></iframe>",
            "embedType": "code",
        },
    }
    odd_quiz = {
        "type": "blockQuiz",
        "attrs": {
            "quizId": None,
            "questions": [
                {
                    "question_id": "q",
                    "question": "x",
                    "answers": [{"answer_id": "a", "answer": "y", "correct": False}],
                },
            ],
        },
    }
    unlinked = {
        "type": "button",
        "attrs": {"link": ""},
        "content": [{"type": "text", "text": "Nowhere"}],
    }
    for node in (
        mixed,
        code_embed,
        odd_quiz,
        unlinked,
        {"type": "scenarios", "attrs": {}},
    ):
        assert not fences.renders(node)
        lines = doc_to_markdown({"type": "doc", "content": [node]})
        assert lines.startswith(f"<!-- block [0] {node['type']}")
    # A question with a "::" in a card front cannot be mistaken for the separator.
    card = {"type": "flipcard", "attrs": {"question": "a :: b", "answer": "c"}}
    back = markdown_to_doc(doc_to_markdown({"type": "doc", "content": [card]}))[
        "content"
    ][0]
    assert (back["attrs"]["question"], back["attrs"]["answer"]) == ("a : b", "c")


def test_fence_names_are_case_insensitive_and_code_fences_are_untouched():
    assert one("```Quiz\nQ: x\n- [x] a\n- [ ] b\n```")["type"] == "blockQuiz"
    code = one("```quizzes\nQ: x\n```")
    assert code["type"] == "codeBlock" and code["attrs"]["language"] == "quizzes"
    assert inline("plain") == [{"type": "text", "text": "plain"}]


EXERCISE = (
    "```exercise\n"
    "language: js\n"
    "difficulty: hard\n"
    "attempts: 5\n"
    "Read two numbers and print their sum.\n"
    "\n"
    "Note: inputs are on separate lines.\n"
    "--- starter\n"
    "const lines = require('fs').readFileSync(0, 'utf8').split('\\n')\n"
    "if (lines) {\n"
    "    // indented\n"
    "}\n"
    "--- solution\n"
    "console.log(1)\n"
    "--- test: Small numbers\n"
    "input:\n"
    "2\n"
    "3\n"
    "output: 5\n"
    "--- test\n"
    "output:\n"
    "0\n"
    "--- hints\n"
    "- Split the input\n"
    "- Add the numbers\n"
    "--- hint\n"
    "Number() turns text into a number.\n"
    "```"
)


def test_exercise_fence_shapes():
    node = one(EXERCISE)
    a = node["attrs"]
    assert node["type"] == "blockCode" and d.strict_problems(node, (0,)) == []
    assert (a["languageId"], a["languageName"], a["difficulty"], a["maxAttemptsBeforeReveal"]) == (
        63, "JavaScript (Node)", "hard", 5,
    )
    # A prose line shaped like a setting belongs to the task once the task began.
    assert a["description"] == "Read two numbers and print their sum.\n\nNote: inputs are on separate lines."
    assert "    // indented\n}\n" in a["starterCode"] and a["solutionCode"] == "console.log(1)\n"
    assert [(t["label"], t["stdin"], t["expectedStdout"]) for t in a["testCases"]] == [
        ("Small numbers", "2\n3", "5"),
        ("Test 2", "", "0"),
    ]
    assert len({t["id"] for t in a["testCases"]}) == 2
    assert a["hints"] == ["Split the input", "Add the numbers", "Number() turns text into a number."]
    # Defaults: Python, medium, three tries.
    plain = one("```exercise\nPrint hello.\n```")["attrs"]
    assert (plain["languageId"], plain["difficulty"], plain["maxAttemptsBeforeReveal"]) == (71, "medium", 3)


@pytest.mark.parametrize(
    "body, problem",
    [
        ("language: python\n--- starter\nx = 1", "needs its task"),
        ("language: cobol\nTask.", "unknown language 'cobol'"),
        ("difficulty: brutal\nTask.", "difficulty must be one of easy, medium, hard"),
        ("Task.\n--- test\n2\n3", "test 1 needs input: and output: lines"),
        ("Task.\n--- test\ninput: 1", "test 1 has no output: line"),
        ("Task.\n--- test\noutput: 1\noutput: 2", "test 1 has two output: lines"),
        ("Task.\n--- starter\na\n--- starter\nb", "one --- starter section"),
        ("Task.\n" + "--- test\noutput: 1\n" * 51, "at most 50 tests"),
    ],
)
def test_exercise_fence_errors(body, problem):
    with pytest.raises(HTTPException) as e:
        markdown_to_doc(f"```exercise\n{body}\n```")
    assert e.value.status_code == 400 and problem in e.value.detail


SCENARIO = (
    "```scenario\n"
    "title: Pick a storage class\n"
    "# start\n"
    "Data is read every minute.\n"
    "Which class fits?\n"
    "image: https://img.test/s3.png\n"
    "- Standard -> right\n"
    "- Glacier → start\n"
    "# right\n"
    "Right: hot data belongs in Standard.\n"
    "- Finish\n"
    "- Leave -> end\n"
    "```"
)


def test_scenario_fence_shapes():
    node = one(SCENARIO)
    a = node["attrs"]
    assert node["type"] == "scenarios" and d.strict_problems(node, (0,)) == []
    assert a["title"] == "Pick a storage class" and a["currentScenarioId"] == "start"
    start, right = a["scenarios"]
    assert (start["id"], start["text"], start["imageUrl"]) == (
        "start", "Data is read every minute.\nWhich class fits?", "https://img.test/s3.png",
    )
    assert [(o["text"], o["nextScenarioId"]) for o in start["options"]] == [("Standard", "right"), ("Glacier", "start")]
    assert [(o["text"], o["nextScenarioId"]) for o in right["options"]] == [("Finish", None), ("Leave", None)]
    assert one("```scenario\n# only\nThe end.\n```")["attrs"]["title"] == fences.SCENARIO_TITLE


@pytest.mark.parametrize(
    "body, problem",
    [
        ("Text first\n# a\nx", "start each step"),
        ("# a\nx\n- go -> nowhere", "leads to 'nowhere', which is not a step"),
        ("# a\nx\n# a\ny", "two steps are named 'a'"),
        ("# a\n- go -> a", "step 'a' has no text"),
        ("# a\nx\n- go -> a\nmore text", "text comes before its options"),
        ("# a\nx\nimage: not-a-url", "image must be an http(s) URL"),
        ("title: Only a title", "needs at least one step"),
    ],
)
def test_scenario_fence_errors(body, problem):
    with pytest.raises(HTTPException) as e:
        markdown_to_doc(f"```scenario\n{body}\n```")
    assert e.value.status_code == 400 and problem in e.value.detail


def test_preview_h5p_and_widget_fences():
    preview = one("```preview\nhttps://aws.amazon.com/s3/\ntitle: Amazon S3\ndescription: Storage: durable\nbutton: Visit S3\nalign: center\n```")
    assert preview["type"] == "blockWebPreview" and d.strict_problems(preview, (0,)) == []
    assert preview["attrs"] == {
        "url": "https://aws.amazon.com/s3/", "title": "Amazon S3", "description": "Storage: durable",
        "alignment": "center", "buttonLabel": "Visit S3", "showButton": True,
    }
    h5p = one("```h5p\nurl: https://h5p.org/h5p/embed/712\nheight: 600\n```")
    assert h5p["attrs"] == {"h5pUrl": "https://h5p.org/h5p/embed/712", "title": "", "height": 600}
    widget = one("```widget\ntitle: Calc\nheight: 500\n\n<!DOCTYPE html>\n<html><body>\n  <p>x: 1</p>\n</body></html>\n```")
    assert widget["type"] == "blockMagic" and d.strict_problems(widget, (0,)) == []
    assert widget["attrs"]["blockUuid"].startswith("mb_") and widget["attrs"]["height"] == 500
    assert widget["attrs"]["htmlContent"] == "<!DOCTYPE html>\n<html><body>\n  <p>x: 1</p>\n</body></html>"
    # All three show outside content or run code, so they count as risky.
    assert all(d.is_risky(n) for n in (preview, h5p, widget))
    for body, problem in (
        ("```preview\ntitle: no url\n```", "needs an http(s) URL"),
        ("```h5p\nhttps://h5p.test/1\nwidth: 3\n```", "cannot read the H5P block line"),
        ("```widget\ntitle: empty\n```", "needs its HTML"),
    ):
        with pytest.raises(HTTPException) as e:
            markdown_to_doc(body)
        assert problem in e.value.detail


def test_exercise_and_scenario_round_trip():
    doc = markdown_to_doc(f"{EXERCISE}\n\n{SCENARIO}")
    text = doc_to_markdown(doc)
    assert "```exercise\nlanguage: javascript\n" in text and "```scenario\ntitle: Pick a storage class\n" in text
    again = markdown_to_doc(text)
    for before, after in zip(doc["content"], again["content"]):
        assert fences._ROUND_TRIP[before["type"]][2](before) == fences._ROUND_TRIP[after["type"]][2](after)
    # Settings the fence cannot carry keep the block a comment, untouched.
    timed = {"type": "blockCode", "attrs": {**doc["content"][0]["attrs"], "sqliteDbPath": "db/shop.db"}}
    unknown = {"type": "blockCode", "attrs": {**doc["content"][0]["attrs"], "languageId": 9999}}
    hinted = {"type": "blockCode", "attrs": {**doc["content"][0]["attrs"], "hints": ["- looks like a list"]}}
    looping = {"type": "scenarios", "attrs": {"scenarios": [
        {"id": "a", "text": "- starts like an option", "options": []},
    ]}}
    for node in (timed, unknown, hinted, looping):
        assert not fences.renders(node)
        assert doc_to_markdown({"type": "doc", "content": [node]}).startswith(f"<!-- block [0] {node['type']}")
    # Previews, H5P and widgets read back as comments, so a rewrite keeps them exactly.
    risky = markdown_to_doc("```preview\nhttps://x.test\n```\n\n```h5p\nhttps://h5p.test/1\n```\n\n```widget\n<p>x</p>\n```")
    text = doc_to_markdown(risky)
    assert [line.split()[3] for line in text.split("\n") if line.startswith("<!-- block")] == [
        "blockWebPreview", "blockH5P", "blockMagic",
    ]


def test_exercise_timing_complexity_and_files_round_trip():
    text = (
        "```exercise\nlanguage: python\ntimed: 15m\ntime limit: 3s\ntime complexity: O(n)\n"
        "space_complexity: O(1)\nSum the numbers.\n--- starter\nfrom utils import read\n"
        "--- file utils.py\ndef read():\n    return 1\n--- test\noutput: 1\n```"
    )
    node = markdown_to_doc(text)["content"][0]
    a = node["attrs"]
    assert (a["timedMode"], a["timedDurationMs"], a["timeLimitMs"]) == (True, 900_000, 3000)
    assert (a["timeComplexity"], a["spaceComplexity"]) == ("O(n)", "O(1)")
    assert a["additionalFiles"] == [{"name": "utils.py", "content": "def read():\n    return 1\n"}]
    assert fences.renders(node)
    again = markdown_to_doc(doc_to_markdown({"type": "doc", "content": [node]}))["content"][0]
    assert fences._exercise_key(again) == fences._exercise_key(node)


def test_exercise_hidden_tests_round_trip():
    text = (
        "```exercise\nlanguage: python\nEcho the input.\n--- test Visible\ninput: a\noutput: a\n"
        "--- test Edge case (hidden)\ninput: b\noutput: b\n--- test (Hidden)\noutput: c\n```"
    )
    node = markdown_to_doc(text)["content"][0]
    tests = node["attrs"]["testCases"]
    assert [(t["label"], t.get("hidden")) for t in tests] == [("Visible", None), ("Edge case", True), ("Test 3", True)]
    assert fences.renders(node)
    written = doc_to_markdown({"type": "doc", "content": [node]})
    assert "--- test Edge case (hidden)" in written and "--- test Visible\n" in written
    again = markdown_to_doc(written)["content"][0]
    assert fences._exercise_key(again) == fences._exercise_key(node)
    # Flipping a test to hidden is a change the key sees.
    shown = {"type": "blockCode", "attrs": {**node["attrs"], "testCases": [{**t, "hidden": False} for t in tests]}}
    assert fences._exercise_key(shown) != fences._exercise_key(node)


@pytest.mark.parametrize("line, error", [
    ("timed: 5s", "timed is a duration"),
    ("timed: soon", "timed is a duration"),
    ("time limit: 2m", "time limit is a duration"),
])
def test_exercise_duration_errors(line, error):
    with pytest.raises(HTTPException) as e:
        markdown_to_doc(f"```exercise\n{line}\nTask.\n```")
    assert error in e.value.detail


def test_exercise_file_errors():
    for body, error in [
        ("--- file\nx", "file name"),
        ("--- file a.py\nx\n--- file a.py\ny", "two --- file"),
        ("".join(f"--- file f{k}.py\nx\n" for k in range(fences.MAX_FILES + 1)), "at most"),
    ]:
        with pytest.raises(HTTPException) as e:
            markdown_to_doc(f"```exercise\nTask.\n{body}\n```")
        assert error in e.value.detail, body
