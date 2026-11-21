"""Pages using every Editor Plus node and attribute, shaped as the web editor
saves them (apps/web/components/Objects/Editor/Extensions/Plus)."""

import copy


def p(text: str, **attrs) -> dict:
    node: dict = {"type": "paragraph", "content": [{"type": "text", "text": text}]}
    if attrs:
        node["attrs"] = attrs
    return node


BLOCK_OBJECT = {"block_uuid": "block_1", "block_type": "BLOCK_IMAGE", "content": {"file_id": "f1", "file_format": "png"}}

TABLE = {
    "type": "table",
    "attrs": {"variant": "striped", "caption": "Team progress", "headerColumn": False, "stickyHeader": True,
              "sortable": True, "compact": False, "totals": "average"},
    "content": [
        {"type": "tableRow", "content": [
            {"type": "tableHeader", "attrs": {"colspan": 1, "rowspan": 1, "colwidth": None, "cellType": "text"}, "content": [p("Task")]},
            {"type": "tableHeader", "content": [p("Status")]},
            {"type": "tableHeader", "content": [p("Progress")]},
        ]},
        {"type": "tableRow", "content": [
            {"type": "tableCell", "attrs": {"cellType": "text", "background": "blue", "align": "start", "valign": "top"}, "content": [p("Write")]},
            {"type": "tableCell", "attrs": {"cellType": "status", "tone": "green"}, "content": [p("Done")]},
            {"type": "tableCell", "attrs": {"cellType": "progress", "numberFormat": "percent", "currency": "USD"}, "content": [p("75")]},
        ]},
    ],
}

QUIZ = {
    "type": "blockQuiz",
    "attrs": {
        "quizId": "quiz_1",
        "settings": {"passMark": 70, "showExplanations": True},
        "questions": [
            {"question_id": "q1", "question": "Leaves are green.", "type": "true_false", "response_type": "single",
             "explanation": "Chlorophyll reflects green light.",
             "answers": [{"answer_id": "a1", "answer": "True", "correct": True},
                         {"answer_id": "a2", "answer": "False", "correct": False}]},
            {"question_id": "q2", "question": "Name the green pigment.", "type": "short_answer", "answers": [],
             "accepted_answers": ["chlorophyll", "42"], "accent_insensitive": True,
             "explanation": "It absorbs red and blue."},
            {"question_id": "q3", "question": "How many CO2 per glucose?", "type": "numeric", "answers": [],
             "correct_value": 6, "tolerance": 0},
        ],
    },
}


def plus_page() -> dict:
    """One page holding every new node and attribute."""
    return copy.deepcopy({"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2, "textAlign": "center"}, "content": [{"type": "text", "text": "Photosynthesis"}]},
        {"type": "paragraph", "attrs": {"textAlign": "justify"}, "content": [
            {"type": "text", "text": "Energy is "}, {"type": "inlineMath", "attrs": {"latex": "E=mc^2"}},
            {"type": "text", "text": " here."}]},
        {"type": "tableOfContents", "attrs": {"title": "On this page", "maxLevel": 3, "numbered": False}},
        TABLE,
        {"type": "callout", "attrs": {"type": "info", "dismissible": False, "title": "Remember", "collapsible": True,
                                      "defaultOpen": False, "tone": "teal", "kind": "note"}, "content": [p("Light is energy.")]},
        {"type": "codeBlock", "attrs": {"language": "python", "showLineNumbers": True, "highlightLines": "2,4-6", "wrap": True},
         "content": [{"type": "text", "text": "print(1)"}]},
        {"type": "tabs", "attrs": {"blockId": "lh_tabs", "variant": "pills"}, "content": [
            {"type": "tabItem", "attrs": {"title": "Light", "icon": None}, "content": [p("Light reactions.")]},
            {"type": "tabItem", "attrs": {"title": "Dark"}, "content": [p("Calvin cycle.")]},
        ]},
        {"type": "columns", "attrs": {"layout": "1-2", "gap": "lg", "stackOnMobile": True, "verticalAlign": "center"}, "content": [
            {"type": "column", "content": [p("Plants")]},
            {"type": "column", "content": [p("Animals")]},
        ]},
        {"type": "accordion", "attrs": {"single": True, "variant": "bordered"}, "content": [
            {"type": "toggleBlock", "attrs": {"summary": "Why green?", "defaultOpen": False, "variant": "filled", "icon": "plus"},
             "content": [p("Reflection.")]},
        ]},
        {"type": "timeline", "attrs": {"variant": "steps", "numbered": True, "orientation": "horizontal"}, "content": [
            {"type": "timelineItem", "attrs": {"title": "Absorb", "label": "Step 1", "icon": "star", "tone": "teal"}, "content": [p("Light hits.")]},
            {"type": "timelineItem", "attrs": {"title": "Split", "label": ""}, "content": [p("Water splits.")]},
        ]},
        {"type": "keyTakeaways", "attrs": {"title": "Remember this", "tone": "amber", "icon": "lightbulb"}, "content": [
            {"type": "bulletList", "content": [{"type": "listItem", "content": [p("Plants make sugar.")]}]},
        ]},
        {"type": "taskList", "attrs": {"blockId": "lh_check", "learnerCanCheck": True}, "content": [
            {"type": "taskItem", "attrs": {"checked": True}, "content": [p("Read")]},
            {"type": "taskItem", "attrs": {"checked": False}, "content": [p("Practice"), p("Twice")]},
        ]},
        {"type": "gallery", "attrs": {"blockId": "lh_gal", "layout": "carousel", "columns": 2, "images": [
            {"id": "img1", "url": "https://example.org/leaf.jpg", "caption": "A leaf", "alt": "Green leaf"},
            {"id": "img2", "blockObject": BLOCK_OBJECT, "alt": "Chloroplast"},
        ]}},
        {"type": "imageCompare", "attrs": {"before": {"url": "https://example.org/a.jpg", "label": "Summer", "alt": "Green tree"},
                                           "after": {"blockObject": BLOCK_OBJECT, "label": "Autumn"}, "start": 40,
                                           "orientation": "vertical"}},
        {"type": "chart", "attrs": {"type": "line", "title": "Growth", "data": {"labels": ["Low", "High"], "series": [
            {"name": "Height", "values": [4, 15.5], "tone": "teal"}, {"name": "Width", "values": [1, 2], "tone": None}]},
            "showLegend": True, "showValues": True, "stacked": False}},
        {"type": "statHighlights", "attrs": {"items": [
            {"id": "s1", "value": "92", "suffix": "%", "label": "Completion", "description": "of learners", "tone": "teal"},
            {"id": "s2", "value": 4.8, "prefix": "~", "label": "Rating"},
        ], "columns": 2, "animate": True}},
        {"type": "fileCard", "attrs": {"url": "https://example.org/sheet.pdf", "name": "Worksheet", "description": "Print it.",
                                       "sizeBytes": 2048, "fileType": "pdf", "blockObject": None}},
        {"type": "quoteBlock", "attrs": {"variant": "testimonial", "author": "Sam", "role": "Designer",
                                         "avatarUrl": "https://example.org/sam.png"}, "content": [p("It clicked.")]},
        {"type": "buttonGroup", "attrs": {"alignment": "center"}, "content": [
            {"type": "button", "attrs": {"emoji": "🔗", "link": "https://example.org", "color": "blue", "alignment": "left",
                                         "variant": "outline", "size": "lg"}, "content": [{"type": "text", "text": "Go"}]},
        ]},
        {"type": "blockImage", "attrs": {"blockObject": BLOCK_OBJECT, "frame": "polaroid", "alt": "x"}},
        QUIZ,
    ]})
