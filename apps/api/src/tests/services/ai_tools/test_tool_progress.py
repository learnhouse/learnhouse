from src.services.ai.tools.progress import progress_reporter, report_progress


def test_progress_is_a_no_op_without_a_reporter():
    report_progress(1, 2, "x")  # nothing installed: nothing happens


def test_progress_reaches_the_installed_reporter_and_never_raises():
    got = []
    with progress_reporter(lambda d, t, label: got.append((d, t, label))):
        report_progress(1, 3, "items")
        report_progress("2", 3)
    report_progress(3, 3)
    assert got == [(1, 3, "items"), (2, 3, None)]

    def broken(*_):
        raise RuntimeError("boom")

    with progress_reporter(broken):
        report_progress(1, 1)
    with progress_reporter(None):
        report_progress(1, 1)
