from src.db.courses.activities import ActivityRead
from src.db.courses.courses import CourseRead
from src.security.auth import resolve_acting_user_id
from src.services.analytics import events as analytics_events
from src.services.analytics.analytics import track


async def track_activity_created(activity, course, current_user) -> None:
    """``activity_created`` for a freshly committed activity, whichever kind of
    create endpoint made it (generic, PDF, uploaded or external video)."""
    activity_type = activity.activity_type
    await track(
        event_name=analytics_events.ACTIVITY_CREATED,
        org_id=course.org_id,
        user_id=resolve_acting_user_id(current_user),
        properties={
            "course_uuid": course.course_uuid,
            "activity_uuid": activity.activity_uuid,
            "activity_type": getattr(activity_type, "value", activity_type) or "",
        },
    )


def structure_activity_content_by_type(activity):
    ### Get Headings, Texts, Callouts, Answers and Paragraphs from the activity as a big list of strings (text only) and return it

    if "content" not in activity or not activity["content"]:
        return []

    content = activity["content"]

    headings = []
    callouts = []
    paragraphs = []

    for item in content:
        if "content" in item:
            if item["type"] == "heading" and "text" in item["content"][0]:
                headings.append(item["content"][0]["text"])
            elif item["type"] in ["calloutInfo", "calloutWarning"] and all(
                "text" in text_item for text_item in item["content"]
            ):
                callouts.append(
                    "".join([text_item["text"] for text_item in item["content"]])
                )
            elif item["type"] == "paragraph" and "text" in item["content"][0]:
                paragraphs.append(item["content"][0]["text"])

    # TODO: Get Questions and Answers (if any)

    data_array = []

    # Add Headings
    data_array.append({"Headings": headings})

    # Add Callouts
    data_array.append({"Callouts": callouts})

    # Add Paragraphs
    data_array.append({"Paragraphs": paragraphs})

    return data_array


def serialize_activity_text_to_ai_comprehensible_text(
    data_array,
    course: CourseRead,
    activity: ActivityRead,
    isActivityEmpty: bool = False,
):

    if isActivityEmpty:
        text = (
            "Use this as a context "
            + 'This is a course about "'
            + course.name
            + '". '
            + 'This is a lecture about "'
            + activity.name
            + '". '
            + "There is no content yet in this lecture."
        )

        return text

    # Serialize Headings
    serialized_headings = ""
    for heading in data_array[0]["Headings"]:
        serialized_headings += heading + " "

    # Serialize Callouts
    serialized_callouts = ""
    for callout in data_array[1]["Callouts"]:
        serialized_callouts += callout + " "

    # Serialize Paragraphs
    serialized_paragraphs = ""
    for paragraph in data_array[2]["Paragraphs"]:
        serialized_paragraphs += paragraph + " "

    # Get a text that is comprehensible by the AI
    text = (
        "Use this as a context "
        + 'This is a course about "'
        + course.name
        + '". '
        + 'This is a lecture about "'
        + activity.name
        + '". '
        'These are the headings: "'
        + serialized_headings
        + '" These are the callouts: "'
        + serialized_callouts
        + '" These are the paragraphs: "'
        + serialized_paragraphs
        + '"'
    )

    return text
