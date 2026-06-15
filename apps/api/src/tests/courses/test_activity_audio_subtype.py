from src.db.courses.activities import (
    ActivityCreate,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)


def test_subtype_audio_enum_value():
    assert ActivitySubTypeEnum.SUBTYPE_AUDIO.value == "SUBTYPE_AUDIO"


def test_activity_create_accepts_audio_subtype():
    activity = ActivityCreate(
        name="Audio overview",
        chapter_id=1,
        activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_AUDIO,
        content={"audio_ref": "media/overview.mp3"},
    )
    assert activity.activity_sub_type is ActivitySubTypeEnum.SUBTYPE_AUDIO
    assert activity.activity_type is ActivityTypeEnum.TYPE_VIDEO
